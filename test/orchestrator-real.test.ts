import { expect, test, describe, beforeAll, afterAll } from 'vitest';
import { ExecutionWorker } from '../src/orchestrator/worker';
import { ExperimentConfig } from '../src/types';
import * as path from 'path';

describe('Phase 6.5 Real Worker Execution', () => {
  test('Worker successfully enforces timeout on real hanging vitest process', async () => {
    const config: ExperimentConfig = {
      experimentId: 'real-1',
      target: 'test/fixtures/hang.test.ts',
      projectPath: process.cwd(),
      runsPerCondition: 1,
      conditionDefs: {
        // The default config excludes test/fixtures, so without this the runner
        // exits "No test files found" instead of hanging. That used to be masked by
        // `npx` start-up latency exceeding the timeout; the worker no longer pays it.
        'c1': { id: 'c1', name: 'C1', env: {}, args: ['-c', 'vitest.worker.config.ts'] },
      },
      conditions: [],
      timeoutMs: 1500 // 1.5 seconds timeout, test hangs for 10s
    };

    const worker = new ExecutionWorker(config);
    const start = Date.now();
    const obs = await worker.execute({ experimentId: 'real-1', conditionId: 'c1', runNumber: 1 });
    const elapsed = Date.now() - start;

    expect(obs.processStatus).toBe('timeout');
    expect(elapsed).toBeLessThan(4000); // Should definitely terminate early
    expect(elapsed).toBeGreaterThanOrEqual(1000); // Accounts for vitest bootup + our 1500ms timeout
  }, 10000);

  test('Worker ensures condition environment isolation', async () => {
    const config: ExperimentConfig = {
      experimentId: 'real-2',
      target: 'test/fixtures/env.test.ts',
      projectPath: process.cwd(),
      runsPerCondition: 1,
      conditionDefs: {
        'env-A': { id: 'env-A', name: 'A', env: { TEST_VAL: 'A' }, args: ['-c', 'vitest.worker.config.ts'] },
        'env-B': { id: 'env-B', name: 'B', env: { TEST_VAL: 'B' }, args: ['-c', 'vitest.worker.config.ts'] },
      },
      conditions: [],
      timeoutMs: 30000
    };

    const worker = new ExecutionWorker(config);
    
    // Run them concurrently without a mock scheduler, just raw workers
    const pA = worker.execute({ experimentId: 'real-2', conditionId: 'env-A', runNumber: 1 });
    await new Promise(r => setTimeout(r, 2000)); // Stagger by 2s to prevent Vitest cache/port boot crash
    const pB = worker.execute({ experimentId: 'real-2', conditionId: 'env-B', runNumber: 1 });

    const [obsA, obsB] = await Promise.all([pA, pB]);

    // If environment leaked across spawn, one of them might fail or they might both get the same value.
    // Vitest parses the status.
    expect(obsA.processStatus).toBe('success');
    expect(obsB.processStatus).toBe('success');
  }, 45000);

  test('Scheduler cancels real running worker cleanly', async () => {
    const { ExecutionScheduler } = await import('../src/orchestrator/scheduler');
    const { ExperimentPlanner } = await import('../src/orchestrator/planner');

    const config: import('../src/types').ExperimentConfig = {
      experimentId: 'real-cancel-1',
      target: 'test/fixtures/hang.test.ts',
      projectPath: process.cwd(),
      runsPerCondition: 2, // 2 runs
      conditionDefs: {
        'c1': { id: 'c1', name: 'C1', env: {}, args: ['-c', 'vitest.worker.config.ts'] },
      },
      conditions: ['c1'],
      timeoutMs: 30000,
      concurrency: 1
    };

    const { LocalFileExperimentRepository } = await import('../src/local-repository');
    const repo = new LocalFileExperimentRepository('test-sandbox/real-cancel-' + Date.now());
    await repo.createExperiment(config);
    
    const tasks = ExperimentPlanner.plan(config, []);
    const scheduler = new ExecutionScheduler(config, repo, tasks, tasks.length);
    
    // Start scheduler without awaiting immediately
    const schedulerPromise = scheduler.run();

    // Give it a tiny bit of time to spawn the first worker
    await new Promise(r => setTimeout(r, 1500));

    // Cancel it!
    scheduler.cancel();

    await schedulerPromise;

    const obs = await repo.getObservations('real-cancel-1');
    // Cancelled observations are intentionally NOT persisted by the Scheduler 
    // because they are incomplete and should be rerun upon resume.
    expect(obs.length).toBe(0); 
  }, 20000);
});
