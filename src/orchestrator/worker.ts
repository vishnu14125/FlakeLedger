import { ExecutionTask } from './planner';
import { ExperimentConfig, Observation } from '../types';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { parseVitestJson } from '../parser';
import * as os from 'os';
import { BoundedCapture, MAX_TERMINAL_OUTPUT_BYTES, MAX_PARSER_BYTES } from './capture';
import { conditionEnv, resolveRunnerArgs, resolveVitestEntry } from './invocation';

/** Orchestrator control-plane variables never reach the test process. */
const WITHHELD_ENV_PREFIX = 'FLAKELEDGER_';

function inheritedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith(WITHHELD_ENV_PREFIX)) env[key] = value;
  }
  return env;
}

/**
 * Runners live in their own process group on POSIX (see `detached` below) so the
 * whole tree can be signalled; on Windows `taskkill /T` walks the tree.
 */
const liveChildren = new Set<ChildProcess>();
let exitHookInstalled = false;

function killTree(child: ChildProcess, sync = false): void {
  const pid = child.pid;
  try {
    if (pid === undefined) {
      child.kill('SIGKILL');
      return;
    }
    if (process.platform === 'win32') {
      const args = ['/pid', String(pid), '/T', '/F'];
      if (sync) spawnSync('taskkill', args, { windowsHide: true, stdio: 'ignore' });
      else spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      return;
    }
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  } catch {
    /* the process has already exited */
  }
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const child of liveChildren) killTree(child, true);
  });
}

export class ExecutionWorker {
  constructor(private config: ExperimentConfig) {}

  public async execute(task: ExecutionTask, signal?: AbortSignal): Promise<Observation> {
    const condition = this.config.conditionDefs[task.conditionId];
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    let processStatus: Observation['processStatus'] = 'process_failure';
    let exitCode: number | null = null;

    // Separate concerns:
    // - Persisted evidence is strictly bounded to 50 KiB to prevent database/payload bloat.
    // - Test result JSON parsing gets a generous 10 MiB limit since valid test suites can emit large JSON,
    //   while still protecting the worker from infinitely hanging test OOMs.
    const stdoutCapture = new BoundedCapture(MAX_TERMINAL_OUTPUT_BYTES);
    const stderrCapture = new BoundedCapture(MAX_TERMINAL_OUTPUT_BYTES);
    const parserCapture = new BoundedCapture(MAX_PARSER_BYTES);

    const attempt = task.attemptNumber ?? 1;
    const observationId = `${task.experimentId}-${task.conditionId}-${task.runNumber}-${attempt}`;

    try {
      if (signal?.aborted) {
        processStatus = 'cancelled';
      } else {
        // No shell: the argument vector below reaches Vitest exactly as written.
        const { targetArgs, conditionArgs } = resolveRunnerArgs(this.config, task.conditionId);
        const entry = resolveVitestEntry(this.config.projectPath);
        const env = { ...inheritedEnv(), ...conditionEnv(this.config, task.conditionId) };

        const child = spawn(
          process.execPath,
          [entry, 'run', ...targetArgs, '--reporter=json', ...conditionArgs],
          {
            cwd: this.config.projectPath,
            env,
            shell: false,
            windowsHide: true,
            // Own process group on POSIX so a kill reaches Vitest's worker processes too.
            detached: process.platform !== 'win32',
          },
        );

        liveChildren.add(child);
        installExitHook();

        let timeoutId: NodeJS.Timeout | null = null;
        let resolved = false;
        let onAbort: (() => void) | null = null;

        const p = new Promise<void>((resolve) => {
          const safeResolve = () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          };

          if (this.config.timeoutMs > 0) {
            timeoutId = setTimeout(() => {
              if (!resolved) {
                processStatus = 'timeout';
                killTree(child);
                safeResolve(); // Force resolve; the tree may take a moment to report close
              }
            }, this.config.timeoutMs);
          }

          if (signal) {
            onAbort = () => {
              if (!resolved) {
                processStatus = 'cancelled';
                killTree(child);
              }
            };
            signal.addEventListener('abort', onAbort, { once: true });
          }

          child.stdout?.on('data', (data) => {
            stdoutCapture.append(data);
            parserCapture.append(data);
          });

          child.stderr?.on('data', (data) => {
            stderrCapture.append(data);
            // Standard vitest JSON output goes to stdout.
            // Stderr is captured here for completeness in case of crashes,
            // matching original F3 behavior where rawStdout accumulated both.
            parserCapture.append(data);
          });

          child.on('error', (err) => {
            if (timeoutId) clearTimeout(timeoutId);
            if (!resolved) {
              processStatus = 'process_failure';
              stderrCapture.append(`\n[Worker] Process error: ${err.message}`);
              safeResolve();
            }
          });

          child.on('close', (code) => {
            if (timeoutId) clearTimeout(timeoutId);
            liveChildren.delete(child);
            if (!resolved) {
              exitCode = code;
              if (signal?.aborted) {
                processStatus = 'cancelled';
              } else if (code === 0) {
                processStatus = 'success';
              } else {
                processStatus = 'test_failure';
              }
              safeResolve();
            }
          });
        });

        try {
          await p;
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
          if (signal && onAbort) signal.removeEventListener('abort', onAbort);
          // A timed-out or cancelled runner must not outlive its observation.
          // (assigned from event callbacks, which control-flow analysis cannot see)
          const finalStatus = processStatus as string;
          if (finalStatus === 'timeout' || finalStatus === 'cancelled') killTree(child);
          liveChildren.delete(child);
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError' || signal?.aborted) {
        processStatus = 'cancelled';
      } else {
        processStatus = 'process_failure';
        stderrCapture.append(`[Worker] ${e?.message ?? String(e)}`);
      }
    }

    const rawStdoutForParsing = parserCapture.getTail();
    let parsedOutput = {};
    try {
      // Vitest might dump text before JSON.
      // Very basic hack: look for first { or [ if it fails.
      // But standard parser gracefully handles empty objects if parse fails.
      parsedOutput = JSON.parse(rawStdoutForParsing);
    } catch {
      // Try to find the json block if there's console noise
      try {
         const match = rawStdoutForParsing.match(/\{[\s\S]*\}/);
         if (match) parsedOutput = JSON.parse(match[0]);
      } catch {}
    }
    const testResults = parseVitestJson(parsedOutput, this.config.projectPath);

    // If Vitest crashed completely and couldn't even emit JSON, we mark as process failure
    if (testResults.length === 0 && (processStatus as string) === 'test_failure') {
      processStatus = 'process_failure';
    }

    return {
      observationId,
      experimentId: task.experimentId,
      conditionId: task.conditionId,
      runNumber: task.runNumber,
      startedAt,
      durationMs: Date.now() - startTime,
      processStatus,
      testResults,
      environment: {
        nodeVersion: process.version,
        platform: os.platform(),
        arch: os.arch(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        args: Array.isArray(condition?.args) ? condition.args : []
      },
      exitCode,
      stdout: stdoutCapture.getTail(),
      stderr: stderrCapture.getTail()
    };
  }
}
