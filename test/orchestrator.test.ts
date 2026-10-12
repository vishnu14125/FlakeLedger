import { expect, test, describe, vi, beforeEach } from 'vitest';
import { ExperimentPlanner, ExecutionTask } from '../src/orchestrator/planner';
import { ExecutionScheduler } from '../src/orchestrator/scheduler';
import { ExecutionWorker } from '../src/orchestrator/worker';
import { ExperimentConfig, Observation } from '../src/types';
import { LocalFileExperimentRepository } from '../src/local-repository';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase 6 Orchestrator - Planner', () => {
  const baseConfig: ExperimentConfig = {
    experimentId: 'test-1',
    target: 'dummy',
    projectPath: '.',
    runsPerCondition: 3,
    conditionDefs: {
      'baseline': { id: 'baseline', name: 'Baseline', env: {}, args: [] },
      'test-cond': { id: 'test-cond', name: 'Test', env: {}, args: [] }
    },
    conditions: ['baseline', 'test-cond'],
    timeoutMs: 1000
  };

  test('Planner generates correct initial tasks', () => {
    const tasks = ExperimentPlanner.plan(baseConfig);
    expect(tasks).toHaveLength(6);
    expect(tasks[0]).toEqual({ experimentId: 'test-1', conditionId: 'baseline', runNumber: 1 });
    expect(tasks[5]).toEqual({ experimentId: 'test-1', conditionId: 'test-cond', runNumber: 3 });
  });

  /** Builds an observation the way ExecutionWorker actually does: one per attempt. */
  const workerObservation = (
    experimentId: string,
    conditionId: string,
    runNumber: number,
    attempt: number,
    processStatus: Observation['processStatus'] = 'success'
  ): Observation => ({
    observationId: `${experimentId}-${conditionId}-${runNumber}-${attempt}`,
    experimentId,
    conditionId,
    runNumber,
    durationMs: 0,
    processStatus,
    testResults: [],
    environment: {} as any,
    startedAt: ''
  });

  test('Planner avoids existing observations with REAL worker-format IDs (Resume)', () => {
    // Regression for R7. The worker suffixes the attempt number, so resume cannot
    // be decided by reconstructing an observation id — it must compare logical-run
    // identity (conditionId + runNumber).
    const existing: Observation[] = [
      workerObservation('test-1', 'baseline', 1, 1),
      workerObservation('test-1', 'test-cond', 2, 1, 'test_failure')
    ];

    const tasks = ExperimentPlanner.plan(baseConfig, existing);
    expect(tasks).toHaveLength(4); // 6 total - 2 recorded
    expect(tasks.find(t => t.conditionId === 'baseline' && t.runNumber === 1)).toBeUndefined();
    expect(tasks.find(t => t.conditionId === 'test-cond' && t.runNumber === 2)).toBeUndefined();
  });

  test('Planner tolerates legacy observation IDs without an attempt suffix', () => {
    // Pre-R7 fixtures (and any legacy rows) carry a 3-segment id. Identity now
    // comes from the conditionId/runNumber fields, so the id shape is irrelevant.
    const legacy: Observation[] = [
      { observationId: 'test-1-baseline-1', experimentId: 'test-1', conditionId: 'baseline', runNumber: 1, durationMs: 0, processStatus: 'success', testResults: [], environment: {} as any, startedAt: '' },
      { observationId: 'test-1-test-cond-2', experimentId: 'test-1', conditionId: 'test-cond', runNumber: 2, durationMs: 0, processStatus: 'test_failure', testResults: [], environment: {} as any, startedAt: '' }
    ];

    const tasks = ExperimentPlanner.plan(baseConfig, legacy);
    expect(tasks).toHaveLength(4);
    expect(tasks.find(t => t.conditionId === 'baseline' && t.runNumber === 1)).toBeUndefined();
    expect(tasks.find(t => t.conditionId === 'test-cond' && t.runNumber === 2)).toBeUndefined();
  });

  test('Planner queues nothing for a fully recorded experiment', () => {
    const all: Observation[] = [];
    for (const conditionId of baseConfig.conditions) {
      for (let runNumber = 1; runNumber <= baseConfig.runsPerCondition; runNumber++) {
        all.push(workerObservation('test-1', conditionId, runNumber, 1));
      }
    }

    expect(ExperimentPlanner.plan(baseConfig, all)).toHaveLength(0);
  });

  test('Planner queues exactly the missing logical runs (Partial resume)', () => {
    const config: ExperimentConfig = {
      ...baseConfig,
      runsPerCondition: 5,
      conditions: ['baseline'],
      conditionDefs: { 'baseline': { id: 'baseline', name: 'Baseline', env: {}, args: [] } }
    };
    const existing = [
      workerObservation('test-1', 'baseline', 1, 1),
      workerObservation('test-1', 'baseline', 3, 1)
    ];

    const tasks = ExperimentPlanner.plan(config, existing);
    expect(tasks.map(t => t.runNumber)).toEqual([2, 4, 5]);
  });

  test('Planner does not re-queue a logical run that needed retries', () => {
    // A retried run owns several observations; it is still one logical run.
    const existing = [
      workerObservation('test-1', 'baseline', 1, 1, 'process_failure'),
      workerObservation('test-1', 'baseline', 1, 2, 'success')
    ];

    const tasks = ExperimentPlanner.plan(baseConfig, existing);
    expect(tasks.filter(t => t.conditionId === 'baseline' && t.runNumber === 1)).toHaveLength(0);
    expect(tasks).toHaveLength(5); // 6 total - 1 recorded logical run
  });

  test('Planner resumes correctly for condition IDs containing hyphens and digits', () => {
    const config: ExperimentConfig = {
      ...baseConfig,
      runsPerCondition: 2,
      conditions: ['order-seed-3', 'order-seed-9'],
      conditionDefs: {
        'order-seed-3': { id: 'order-seed-3', name: 'Seed 3', env: {}, args: [] },
        'order-seed-9': { id: 'order-seed-9', name: 'Seed 9', env: {}, args: [] }
      }
    };
    const existing = [
      workerObservation('test-1', 'order-seed-3', 1, 1),
      workerObservation('test-1', 'order-seed-9', 2, 1)
    ];

    const tasks = ExperimentPlanner.plan(config, existing);
    expect(tasks).toHaveLength(2);
    expect(tasks).toContainEqual({ experimentId: 'test-1', conditionId: 'order-seed-3', runNumber: 2 });
    expect(tasks).toContainEqual({ experimentId: 'test-1', conditionId: 'order-seed-9', runNumber: 1 });
  });

  test('Planner does not confuse one condition for another with a shared prefix', () => {
    const config: ExperimentConfig = {
      ...baseConfig,
      runsPerCondition: 1,
      conditions: ['cond', 'cond-1'],
      conditionDefs: {
        'cond': { id: 'cond', name: 'Cond', env: {}, args: [] },
        'cond-1': { id: 'cond-1', name: 'Cond 1', env: {}, args: [] }
      }
    };
    // Only `cond-1` run 1 is recorded; `cond` run 1 must still be queued.
    const tasks = ExperimentPlanner.plan(config, [workerObservation('test-1', 'cond-1', 1, 1)]);
    expect(tasks).toEqual([{ experimentId: 'test-1', conditionId: 'cond', runNumber: 1 }]);
  });

  test('Planner ignores observations belonging to a different experiment', () => {
    // The key is scoped to the experiment, so a same-named run recorded under
    // another experiment cannot mark this one complete.
    const foreign = [workerObservation('other-experiment', 'baseline', 1, 1)];
    const tasks = ExperimentPlanner.plan(baseConfig, foreign);

    expect(tasks).toHaveLength(6);
    expect(tasks).toContainEqual({ experimentId: 'test-1', conditionId: 'baseline', runNumber: 1 });
  });

  test('Planner throws on unknown condition ID', () => {
    const badConfig = { ...baseConfig, conditions: ['unknown'] };
    expect(() => ExperimentPlanner.plan(badConfig)).toThrow(/not defined/);
  });
});

describe('Phase 6 Orchestrator - Scheduler', () => {
  let tempDir: string;
  let repo: LocalFileExperimentRepository;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flake-sched-'));
    repo = new LocalFileExperimentRepository(tempDir);
  });

  test('Scheduler honors concurrency limit', async () => {
    const config: ExperimentConfig = {
      experimentId: 'sched-1',
      target: 'dummy',
      projectPath: '.',
      runsPerCondition: 4,
      conditionDefs: { 'c1': { id: 'c1', name: 'C1', env: {}, args: [] } },
      conditions: ['c1'],
      timeoutMs: 1000,
      concurrency: 2
    };
    await repo.createExperiment(config);

    const tasks = ExperimentPlanner.plan(config);
    const scheduler = new ExecutionScheduler(config, repo, tasks, tasks.length);

    let activeWorkers = 0;
    let maxWorkers = 0;

    // Mock the execute function
    vi.spyOn(ExecutionWorker.prototype, 'execute').mockImplementation(async (task) => {
      activeWorkers++;
      if (activeWorkers > maxWorkers) maxWorkers = activeWorkers;
      await new Promise(r => setTimeout(r, 20)); // simulated work
      activeWorkers--;
      return {
        observationId: `${task.experimentId}-${task.conditionId}-${task.runNumber}-${task.attemptNumber || 1}`,
        experimentId: task.experimentId,
        conditionId: task.conditionId,
        runNumber: task.runNumber,
        startedAt: new Date().toISOString(),
        durationMs: 20,
        processStatus: 'success',
        testResults: [],
        environment: {} as any
      };
    });

    await scheduler.run();
    expect(maxWorkers).toBe(2);
    const obs = await repo.getObservations('sched-1');
    expect(obs).toHaveLength(4);
  });

  test('Scheduler retries on process_failure only', async () => {
    const config: ExperimentConfig = {
      experimentId: 'sched-2',
      target: 'dummy',
      projectPath: '.',
      runsPerCondition: 1,
      conditionDefs: { 'c1': { id: 'c1', name: 'C1', env: {}, args: [] } },
      conditions: ['c1'],
      timeoutMs: 1000,
      concurrency: 1,
      retryPolicy: { maxRetries: 2 }
    };
    await repo.createExperiment(config);

    const tasks = ExperimentPlanner.plan(config);
    const scheduler = new ExecutionScheduler(config, repo, tasks, tasks.length);
    let attempts = 0;

    vi.spyOn(ExecutionWorker.prototype, 'execute').mockImplementation(async (task) => {
      attempts++;
      return {
        observationId: `sched-2-c1-1-${task.attemptNumber || 1}`,
        experimentId: 'sched-2',
        conditionId: 'c1',
        runNumber: 1,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        processStatus: attempts < 2 ? 'process_failure' : 'success', // fail first, then succeed
        testResults: [],
        environment: {} as any
      };
    });

    await scheduler.run();
    expect(attempts).toBe(2); // Should retry once
    const obs = await repo.getObservations('sched-2');
    expect(obs).toHaveLength(2);
    // Both attempts should be preserved
    const failObs = obs.find(o => o.observationId === 'sched-2-c1-1-1');
    const successObs = obs.find(o => o.observationId === 'sched-2-c1-1-2');
    expect(failObs!.processStatus).toBe('process_failure');
    expect(successObs!.processStatus).toBe('success');
  });

  test('Scheduler failFast stops execution instantly', async () => {
    const config: ExperimentConfig = {
      experimentId: 'sched-3',
      target: 'dummy',
      projectPath: '.',
      runsPerCondition: 5,
      conditionDefs: { 'c1': { id: 'c1', name: 'C1', env: {}, args: [] } },
      conditions: ['c1'],
      timeoutMs: 1000,
      concurrency: 1,
      failFast: true
    };
    await repo.createExperiment(config);

    const tasks = ExperimentPlanner.plan(config);
    const scheduler = new ExecutionScheduler(config, repo, tasks, tasks.length);
    let attempts = 0;

    vi.spyOn(ExecutionWorker.prototype, 'execute').mockImplementation(async (task) => {
      attempts++;
      return {
        observationId: `sched-3-c1-${task.runNumber}-${task.attemptNumber || 1}`,
        experimentId: 'sched-3',
        conditionId: 'c1',
        runNumber: task.runNumber,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        processStatus: task.runNumber === 2 ? 'process_failure' : 'success', // Infrastructure crash on run 2
        testResults: [],
        environment: {} as any
      };
    });

    await scheduler.run();
    expect(attempts).toBe(2); // Run 1 succeeds, Run 2 crashes and failFast triggers
    const obs = await repo.getObservations('sched-3');
    expect(obs.length).toBe(2); // The crashed obs is still persisted before cancellation halts the rest
  });

  test('Scheduler does NOT retry on test_failure or timeout', async () => {
    const repo = new LocalFileExperimentRepository('test-sandbox/sched-4-' + Date.now());
    const config: ExperimentConfig = {
      experimentId: 'sched-4',
      target: 'noop',
      projectPath: '/',
      runsPerCondition: 2,
      conditionDefs: { 'c1': { id: 'c1', name: 'C1', env: {}, args: [] } },
      conditions: ['c1'],
      timeoutMs: 1000,
      retryPolicy: { maxRetries: 3 }
    };
    
    await repo.createExperiment(config);
    const tasks = ExperimentPlanner.plan(config, []);
    
    const scheduler = new ExecutionScheduler(config, repo, tasks, tasks.length);
    
    let attempts = 0;
    vi.spyOn(ExecutionWorker.prototype, 'execute').mockImplementation(async (task) => {
      attempts++;
      return {
        observationId: `sched-4-c1-${task.runNumber}-${task.attemptNumber || 1}`,
        experimentId: 'sched-4',
        conditionId: 'c1',
        runNumber: task.runNumber,
        startedAt: new Date().toISOString(),
        durationMs: 100,
        processStatus: task.runNumber === 1 ? 'test_failure' : 'timeout',
        testResults: [],
        environment: { nodeVersion: '20', platform: 'linux', arch: 'x64', timezone: 'UTC', args: [] }
      };
    });

    await scheduler.run();
    
    // Exactly 2 attempts (1 for run 1, 1 for run 2). No retries!
    expect(attempts).toBe(2);
    const obs = await repo.getObservations('sched-4');
    expect(obs).toHaveLength(2);
    expect(obs[0].processStatus).toBe('test_failure');
    expect(obs[1].processStatus).toBe('timeout');
  });
});
