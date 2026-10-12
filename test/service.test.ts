import { expect, test, describe, beforeEach, vi, afterEach } from 'vitest';
import { ExperimentService } from '../src/service';
import { LocalFileExperimentRepository } from '../src/local-repository';
import { ExecutionWorker } from '../src/orchestrator/worker';
import { ExperimentConfig } from '../src/types';
import * as fs from 'fs';

describe('Phase 7 Application Service Layer', () => {
  const repoDir = 'test-sandbox/service-test';
  
  beforeEach(() => {
    if (fs.existsSync(repoDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseConfig: ExperimentConfig = {
    experimentId: 'svc-1',
    target: 'test/fixtures/env.test.ts',
    projectPath: process.cwd(),
    runsPerCondition: 1,
    conditionDefs: {
      'c1': { id: 'c1', name: 'C1', env: {}, args: ['-c', 'vitest.worker.config.ts'] }
    },
    conditions: ['c1'],
    timeoutMs: 5000,
  };

  test('Service validates lifecycle bounds and triggers execution asynchronously', async () => {
    const repo = new LocalFileExperimentRepository(repoDir);
    const service = new ExperimentService(repo);

    await service.createExperiment(baseConfig);
    const meta1 = await service.getExperiment('svc-1');
    expect(meta1.status).toBe('created');

    // Trigger execute
    const executePromise = service.executeExperiment('svc-1'); // should resolve almost immediately (async start)
    await executePromise;

    // Immediately after returning, status should be 'running'
    const meta2 = await service.getExperiment('svc-1');
    expect(meta2.status).toBe('running');

    // Try executing again -> conflict
    await expect(service.executeExperiment('svc-1')).rejects.toThrow('EXPERIMENT_ALREADY_RUNNING');

    // Wait for it to naturally complete (poll)
    for (let i = 0; i < 20; i++) {
      const meta = await service.getExperiment('svc-1');
      if (meta.status === 'completed') break;
      await new Promise(r => setTimeout(r, 500));
    }
    
    const meta3 = await service.getExperiment('svc-1');
    expect(meta3.status).toBe('completed');
  }, 15000);

  test('Service prevents near-concurrent execution requests', async () => {
    const repo = new LocalFileExperimentRepository(repoDir);
    const service = new ExperimentService(repo);

    await service.createExperiment({ ...baseConfig, experimentId: 'svc-conc' });

    // Fire 3 simultaneous executions
    const p1 = service.executeExperiment('svc-conc');
    const p2 = service.executeExperiment('svc-conc');
    const p3 = service.executeExperiment('svc-conc');

    const results = await Promise.allSettled([p1, p2, p3]);
    
    // Exactly one should fulfill
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    
    expect((rejected[0] as any).reason.message).toBe('EXPERIMENT_ALREADY_RUNNING');

    // Wait for the single active one to finish
    for (let i = 0; i < 20; i++) {
      const meta = await service.getExperiment('svc-conc');
      if (meta.status === 'completed') break;
      await new Promise(r => setTimeout(r, 500));
    }
  }, 15000);

  test('Service cancels execution securely', async () => {
    const repo = new LocalFileExperimentRepository(repoDir);
    const service = new ExperimentService(repo);

    const config = { ...baseConfig, experimentId: 'svc-2', target: 'test/fixtures/hang.test.ts' };
    await service.createExperiment(config);
    
    await service.executeExperiment('svc-2');
    
    // Give it time to spawn
    await new Promise(r => setTimeout(r, 1000));
    
    // Cancel
    await service.cancelExperiment('svc-2');

    const meta = await service.getExperiment('svc-2');
    expect(meta.status).toBe('cancelled');

    // Trying to cancel again -> error
    await expect(service.cancelExperiment('svc-2')).rejects.toThrow('EXPERIMENT_NOT_RUNNING');
  }, 10000);

  test('Service seamlessly resumes experiment on new instance (restart simulation)', async () => {
    // 1. First instance
    const repo1 = new LocalFileExperimentRepository(repoDir);
    const service1 = new ExperimentService(repo1);
    
    await service1.createExperiment({ ...baseConfig, experimentId: 'svc-res', runsPerCondition: 2 });
    
    // We execute, let it do 1 run, then cancel it to simulate "crashing" midway
    const p = service1.executeExperiment('svc-res');
    await new Promise(r => setTimeout(r, 1500)); // wait for 1st run
    await service1.cancelExperiment('svc-res'); // Halt
    
    const obs1 = await service1.getObservations('svc-res');
    // At least some runs should have started/completed or we cancelled early
    // We will just verify it can be resumed
    
    // 2. New instance (simulate API restart)
    const repo2 = new LocalFileExperimentRepository(repoDir);
    const service2 = new ExperimentService(repo2);
    
    const metaAfterRestart = await service2.getExperiment('svc-res');
    expect(metaAfterRestart.status).toBe('cancelled');
    
    // Resume
    service2.executeExperiment('svc-res');
    
    for (let i = 0; i < 20; i++) {
      const meta = await service2.getExperiment('svc-res');
      if (meta.status === 'completed') break;
      await new Promise(r => setTimeout(r, 500));
    }
    
    const metaFinal = await service2.getExperiment('svc-res');
    expect(metaFinal.status).toBe('completed');
    
    const obsFinal = await service2.getObservations('svc-res');
    expect(obsFinal.length).toBe(2); // 2 runs
  }, 20000);


  test('Re-executing a fully observed experiment runs nothing and records nothing (R7)', async () => {
    const repo = new LocalFileExperimentRepository(repoDir);
    const service = new ExperimentService(repo);

    const config: ExperimentConfig = {
      ...baseConfig,
      experimentId: 'svc-r7',
      runsPerCondition: 2,
      conditions: ['c1', 'c2'],
      conditionDefs: {
        'c1': { id: 'c1', name: 'C1', env: {}, args: [] },
        'c2': { id: 'c2', name: 'C2', env: {}, args: [] }
      }
    };
    await service.createExperiment(config);

    // Seed a complete set of observations in the exact shape ExecutionWorker
    // writes them: one per attempt, attempt number suffixed. c1 run 1 took two
    // attempts, so the store holds more observations than logical runs.
    const observation = (conditionId: string, runNumber: number, attempt: number, processStatus: any) => ({
      observationId: `svc-r7-${conditionId}-${runNumber}-${attempt}`,
      experimentId: 'svc-r7',
      conditionId,
      runNumber,
      startedAt: new Date(2026, 0, 1, 0, runNumber, attempt).toISOString(),
      durationMs: 10,
      processStatus,
      testResults: [],
      environment: { nodeVersion: 'v20', platform: 'linux', arch: 'x64', timezone: 'UTC', args: [] }
    });

    const seeded = [
      observation('c1', 1, 1, 'process_failure'),
      observation('c1', 1, 2, 'success'),
      observation('c1', 2, 1, 'success'),
      observation('c2', 1, 1, 'success'),
      observation('c2', 2, 1, 'success')
    ];
    await repo.saveObservations('svc-r7', seeded as any);

    const before = await service.getObservations('svc-r7');
    expect(before).toHaveLength(5); // 4 logical runs, 5 attempts

    // No worker may be spawned: every planned logical run is already on record.
    const workerSpy = vi.spyOn(ExecutionWorker.prototype, 'execute');

    await service.executeExperiment('svc-r7');

    // Give any scheduler that was (incorrectly) started a chance to do damage.
    await new Promise(r => setTimeout(r, 300));

    expect(workerSpy).not.toHaveBeenCalled();

    const after = await service.getObservations('svc-r7');
    expect(after).toHaveLength(5);
    // Byte-for-byte unchanged: nothing added, nothing mutated, nothing reordered.
    expect(after).toEqual(before);

    const meta = await service.getExperiment('svc-r7');
    expect(meta.status).toBe('completed');
  }, 10000);

});
