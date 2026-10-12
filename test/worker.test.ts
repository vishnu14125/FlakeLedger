import { expect, test, describe, vi } from 'vitest';
import { ExecutionWorker } from '../src/orchestrator/worker';
import { ExperimentConfig } from '../src/types';
import * as cp from 'child_process';
import { EventEmitter } from 'events';

vi.mock('child_process');

describe('Phase 6 Worker Execution', () => {
  const baseConfig: ExperimentConfig = {
    experimentId: 'worker-1',
    target: 'foo.ts',
    projectPath: '.',
    runsPerCondition: 1,
    conditionDefs: {
      'c1': { id: 'c1', name: 'C1', env: {}, args: [] },
    },
    conditions: [],
    timeoutMs: 100 // 100ms strict timeout
  };

  test('Worker successfully parses stdout when test finishes in time', async () => {
    const worker = new ExecutionWorker(baseConfig);
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.kill = vi.fn();

    vi.mocked(cp.spawn).mockReturnValue(mockChild);

    const p = worker.execute({ experimentId: 'worker-1', conditionId: 'c1', runNumber: 1 });

    // simulate vitest returning JSON output
    mockChild.stdout.emit('data', '{"testResults": [{"name": "test1", "assertionResults": [{"title": "test1", "status": "passed"}]}]}');
    mockChild.emit('close', 0);

    const obs = await p;
    expect(obs.processStatus).toBe('success');
    expect(obs.testResults).toHaveLength(1);
  });

  test('Worker enforces timeout and terminates child process', async () => {
    const worker = new ExecutionWorker(baseConfig);
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.kill = vi.fn();

    vi.mocked(cp.spawn).mockReturnValue(mockChild);

    const p = worker.execute({ experimentId: 'worker-1', conditionId: 'c1', runNumber: 1 });

    // Don't emit close immediately, wait for timeout
    await new Promise(r => setTimeout(r, 150));

    mockChild.emit('close', 1); // Simulate kill resolving the close event

    const obs = await p;
    expect(obs.processStatus).toBe('timeout');
    expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
  });

  test('Worker correctly captures process_failure on crash', async () => {
    const worker = new ExecutionWorker(baseConfig);
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();

    vi.mocked(cp.spawn).mockReturnValue(mockChild);

    const p = worker.execute({ experimentId: 'worker-1', conditionId: 'c1', runNumber: 1 });

    mockChild.emit('error', new Error('Spawn Failed'));

    const obs = await p;
    expect(obs.processStatus).toBe('process_failure');
  });

  test('7. stdout and stderr are bounded independently', async () => {
    const worker = new ExecutionWorker(baseConfig);
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.kill = vi.fn();

    vi.mocked(cp.spawn).mockReturnValue(mockChild);

    const p = worker.execute({ experimentId: 'worker-1', conditionId: 'c1', runNumber: 1 });

    // Both exceed 50KB limits
    const bigStdout = Buffer.alloc(60 * 1024, 'a');
    bigStdout.fill('b', 10 * 1024); // last 50KB is 'b'
    const bigStderr = Buffer.alloc(70 * 1024, 'x');
    bigStderr.fill('y', 20 * 1024); // last 50KB is 'y'

    mockChild.stdout.emit('data', bigStdout);
    mockChild.stderr.emit('data', bigStderr);
    mockChild.emit('close', 1);

    const obs = await p;
    expect(obs.processStatus).toBe('process_failure');
    expect(obs.stdout?.length).toBe(50 * 1024);
    expect(obs.stdout).toBe('b'.repeat(50 * 1024));
    expect(obs.stderr?.length).toBe(50 * 1024);
    expect(obs.stderr).toBe('y'.repeat(50 * 1024));
  });

  test('8. Valid Vitest JSON larger than 50 KiB retains correctness', async () => {
    const worker = new ExecutionWorker(baseConfig);
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.kill = vi.fn();

    vi.mocked(cp.spawn).mockReturnValue(mockChild);

    const p = worker.execute({ experimentId: 'worker-1', conditionId: 'c1', runNumber: 1 });

    // Simulate noisy process that also outputs 60KB of valid JSON
    mockChild.stdout.emit('data', Buffer.alloc(100 * 1024, 'NOISE\n'));

    // Create large JSON response
    const assertions = Array(1000).fill({ title: 'test', status: 'passed' });
    const jsonStr = JSON.stringify({ testResults: [{ name: 'test1', assertionResults: assertions }] });
    // This JSON is around 40+ KB, let's pad it to ensure it's > 50KB
    const bigJsonStr = jsonStr + ' '.repeat(50 * 1024);

    mockChild.stdout.emit('data', Buffer.from(bigJsonStr));
    mockChild.emit('close', 0);

    const obs = await p;
    // Should successfully parse test result despite stdout being truncated
    expect(obs.processStatus).toBe('success');
    expect(obs.testResults).toHaveLength(1000);
    expect(obs.stdout?.length).toBe(50 * 1024);
  });

  test('Worker gracefully handles AbortController cancellation', async () => {
    const worker = new ExecutionWorker(baseConfig);
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();

    vi.mocked(cp.spawn).mockReturnValue(mockChild);

    const controller = new AbortController();
    const p = worker.execute({ experimentId: 'worker-1', conditionId: 'c1', runNumber: 1 }, controller.signal);

    controller.abort();
    mockChild.emit('close', null);

    const obs = await p;
    expect(obs.processStatus).toBe('cancelled');
  });
});
