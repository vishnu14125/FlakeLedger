import { ExecutionTask } from './planner';
import { ExecutionWorker } from './worker';
import { ExperimentConfig, Observation } from '../types';
import { IExperimentRepository } from '../repository';
import * as os from 'os';

export class ExecutionScheduler {
  private abortController = new AbortController();
  private completedCount = 0;
  private cancelled = false;

  private sigHandler = () => {
    console.log('\n[Scheduler] Caught interrupt signal. Cancelling execution safely...');
    this.cancel();
  };

  constructor(
    private config: ExperimentConfig,
    private repo: IExperimentRepository,
    private tasks: ExecutionTask[],
    private totalPlanned: number
  ) {
    process.on('SIGINT', this.sigHandler);
  }

  public cancel() {
    this.cancelled = true;
    this.abortController.abort();
  }

  private async executeTaskWithRetry(worker: ExecutionWorker, task: ExecutionTask): Promise<Observation> {
    const maxRetries = this.config.retryPolicy?.maxRetries ?? 0;
    let attempts = 0;
    let lastObs: Observation | null = null;
    
    while (true) {
      attempts++;
      const currentTask = { ...task, attemptNumber: attempts };
      const obs = await worker.execute(currentTask, this.abortController.signal);
      
      // Persist the attempt immediately so evidence is not lost
      if (!this.cancelled) {
        await this.repo.saveObservations(task.experimentId, [obs]);
      }
      
      lastObs = obs;
      
      // Retry ONLY on process_failure (infrastructure/spawn crash). 
      // NEVER retry on test_failure or timeout (that hides flaky evidence).
      if (obs.processStatus === 'process_failure' && attempts <= maxRetries && !this.cancelled) {
        console.warn(`\n[Scheduler] Infrastructure failure on ${obs.observationId}. Retrying (attempt ${attempts}/${maxRetries})...`);
        continue;
      }
      
      return obs;
    }
  }

  public async run(): Promise<void> {
    const worker = new ExecutionWorker(this.config);
    let concurrency = this.config.concurrency ?? 1;
    if (concurrency < 1) concurrency = 1;
    // Sensible upper bound to prevent fork bombs
    if (concurrency > os.cpus().length * 2) concurrency = os.cpus().length * 2;

    const inProgress = new Set<Promise<void>>();

    // Dispatch loop
    while (this.tasks.length > 0 && !this.cancelled) {
      if (inProgress.size >= concurrency) {
        // Wait for at least one worker to finish before spawning more
        await Promise.race(inProgress);
        continue;
      }

      const task = this.tasks.shift();
      if (!task) break;

      const p = (async () => {
        try {
          const obs = await this.executeTaskWithRetry(worker, task);
          if (!this.cancelled) {
            this.completedCount++;
            this.printProgress(task, obs);

            if (this.config.failFast && obs.processStatus === 'process_failure') {
              console.error(`\n[Scheduler] Fail-fast triggered by infrastructure failure on ${obs.observationId}`);
              this.cancel();
            }
          }
        } catch (e) {
          // Worker catches all internally, but just in case
        }
      })();

      inProgress.add(p);
      p.finally(() => inProgress.delete(p));
    }

    // Wait for remaining in-flight tasks
    if (inProgress.size > 0) {
      await Promise.allSettled(Array.from(inProgress));
    }

    process.off('SIGINT', this.sigHandler);
  }

  private printProgress(task: ExecutionTask, obs: Observation) {
    const overall = `${this.completedCount}/${this.totalPlanned}`;
    console.log(`[${overall}] ${obs.conditionId} run ${obs.runNumber} -> ${obs.processStatus.toUpperCase()}`);
  }
}
