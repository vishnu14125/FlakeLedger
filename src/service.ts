import { ExperimentMetadata, Observation, ExperimentConfig, ListExperimentsOptions, PaginatedHistory } from './types';
import { IExperimentRepository } from './repository';
import { DiagnosisResult, analyzeExperiment } from './diagnosis';
import { ExperimentPlanner } from './orchestrator/planner';
import { ExecutionScheduler } from './orchestrator/scheduler';
import { validateExperimentConfig } from './validator';

const MUTABLE_STATUSES: ExperimentMetadata['status'][] = ['created', 'running', 'completed', 'failed', 'cancelled'];

export class ExperimentService {
  private activeSchedulers = new Map<string, ExecutionScheduler>();

  constructor(private repo: IExperimentRepository) {}

  public async createExperiment(config: ExperimentConfig): Promise<ExperimentMetadata> {
    // The worker executes what is persisted here, so nothing unvalidated is stored.
    validateExperimentConfig(config);
    return await this.repo.createExperiment(config);
  }

  public async getExperiment(id: string): Promise<ExperimentMetadata> {
    const meta = await this.repo.getMetadata(id);
    if (!meta) throw new Error('EXPERIMENT_NOT_FOUND');
    return meta;
  }

  /**
   * Only lifecycle fields may change after creation. `config` is what the worker
   * executes and is immutable: replacing it would bypass creation-time validation
   * and rewrite the record of what an investigation actually ran.
   */
  public async updateExperiment(id: string, updates: Partial<ExperimentMetadata>): Promise<void> {
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new Error('INVALID_UPDATE');
    const allowed: Partial<ExperimentMetadata> = {};
    for (const key of Object.keys(updates)) {
      if (key !== 'status' && key !== 'summary') throw new Error('INVALID_UPDATE');
    }
    if (updates.status !== undefined) {
      if (!MUTABLE_STATUSES.includes(updates.status)) throw new Error('INVALID_UPDATE');
      allowed.status = updates.status;
    }
    if (updates.summary !== undefined) {
      if (typeof updates.summary !== 'object' || updates.summary === null || Array.isArray(updates.summary)) {
        throw new Error('INVALID_UPDATE');
      }
      allowed.summary = updates.summary;
    }
    await this.repo.updateMetadata(id, allowed);
  }

  public async listExperiments(options?: ListExperimentsOptions): Promise<PaginatedHistory> {
    return await this.repo.listExperiments(options);
  }

  public async saveObservations(id: string, observations: Observation[]): Promise<void> {
    // Validate that observations belong to this experiment
    if (observations.some(obs => obs.experimentId !== id)) {
      throw new Error('OBSERVATION_MISMATCH');
    }
    await this.repo.saveObservations(id, observations);
  }

  public async getObservations(id: string): Promise<Observation[]> {
    return await this.repo.getObservations(id);
  }

  public async getObservationTerminal(id: string, obsId: string): Promise<{stdout?: string, stderr?: string, exitCode?: number | null} | null> {
    return await this.repo.getObservationTerminal(id, obsId);
  }

  public async getDiagnosis(id: string): Promise<DiagnosisResult | null> {
    return await this.repo.getDiagnosis(id);
  }

  public async runDiagnosis(id: string): Promise<DiagnosisResult> {
    const meta = await this.repo.getMetadata(id);
    if (!meta) throw new Error('EXPERIMENT_NOT_FOUND');
    
    const obs = await this.repo.getObservations(id);
    
    // Pure Domain logic decoupled from storage
    const result = analyzeExperiment(meta.config, obs);
    
    await this.repo.saveDiagnosis(id, result);
    return result;
  }

  public async executeExperiment(id: string): Promise<void> {
    if (this.activeSchedulers.has(id)) {
      throw new Error('EXPERIMENT_ALREADY_RUNNING');
    }

    // Set a placeholder immediately to prevent near-concurrent duplicates
    this.activeSchedulers.set(id, {} as ExecutionScheduler);

    try {
      const meta = await this.repo.getMetadata(id);
      if (!meta) {
        this.activeSchedulers.delete(id);
        throw new Error('EXPERIMENT_NOT_FOUND');
      }

      // Re-validate what is about to be executed: records created before the
      // server enforced these rules, or edited on disk, are not trusted either.
      try {
        validateExperimentConfig(meta.config);
      } catch (e: any) {
        this.activeSchedulers.delete(id);
        throw new Error(`INVALID_CONFIG: ${e.message}`);
      }

      await this.repo.updateMetadata(id, { status: 'running' });

      const existingObs = await this.repo.getObservations(id);
      const tasks = ExperimentPlanner.plan(meta.config, existingObs);
      const totalPlanned = existingObs.length + tasks.length;

      if (tasks.length === 0) {
        this.activeSchedulers.delete(id);
        await this.repo.updateMetadata(id, { status: 'completed' });
        return;
      }

      const scheduler = new ExecutionScheduler(meta.config, this.repo, tasks, totalPlanned);
      this.activeSchedulers.set(id, scheduler);

      // Run asynchronously without blocking the service caller
      scheduler.run().then(async () => {
        // A cancelled scheduler is removed from the map by cancelExperiment and
        // its status is already final. Terminating a runner's process tree can
        // take a moment, so this callback may fire after a newer execution of the
        // same experiment has set 'running'; it must not overwrite that.
        if (this.activeSchedulers.get(id) !== scheduler) return;
        this.activeSchedulers.delete(id);
        const latestMeta = await this.repo.getMetadata(id);
        if (latestMeta?.status === 'running') {
          await this.repo.updateMetadata(id, { status: 'completed' });
        }
      }).catch(async (err) => {
        console.error(`[ExperimentService] Unhandled execution error for ${id}:`, err);
        if (this.activeSchedulers.get(id) !== scheduler) return;
        this.activeSchedulers.delete(id);
        await this.repo.updateMetadata(id, { status: 'failed' });
      });
    } catch (err) {
      this.activeSchedulers.delete(id);
      throw err;
    }
  }

  public async cancelExperiment(id: string): Promise<void> {
    const meta = await this.repo.getMetadata(id);
    if (!meta) throw new Error('EXPERIMENT_NOT_FOUND');

    const scheduler = this.activeSchedulers.get(id);
    if (!scheduler) {
      throw new Error('EXPERIMENT_NOT_RUNNING');
    }

    if (typeof scheduler.cancel === 'function') {
      scheduler.cancel();
    }
    
    this.activeSchedulers.delete(id);
    await this.repo.updateMetadata(id, { status: 'cancelled' });
  }

  /**
   * Cancels every running investigation (server shutdown). Aborting the
   * scheduler terminates each runner's process tree.
   */
  public async cancelAll(): Promise<void> {
    const ids = Array.from(this.activeSchedulers.keys());
    await Promise.allSettled(ids.map((id) => this.cancelExperiment(id)));
  }
}
