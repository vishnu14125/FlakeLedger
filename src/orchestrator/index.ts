import { ExperimentConfig } from '../types';
import { IExperimentRepository } from '../repository';
import { ExperimentService } from '../service';
import { validateExperimentConfig } from '../validator';

export async function runExperiment(config: ExperimentConfig, repo: IExperimentRepository): Promise<void> {
  validateExperimentConfig(config);
  
  const service = new ExperimentService(repo);
  
  try {
    await service.getExperiment(config.experimentId);
    // Already exists
  } catch (e: any) {
    if (e.message === 'EXPERIMENT_NOT_FOUND') {
      await service.createExperiment(config);
    } else {
      throw e;
    }
  }

  const existingObs = await service.getObservations(config.experimentId);
  const totalPlanned = existingObs.length + (config.runsPerCondition * config.conditions.length); // Rough estimate for console log
  
  console.log(`\n[Orchestrator] Experiment ${config.experimentId} started.`);
  console.log(`[Orchestrator] Resuming: ${existingObs.length}/${totalPlanned} already completed.`);
  console.log(`[Orchestrator] Concurrency: ${config.concurrency ?? 1}, Timeout: ${config.timeoutMs}ms`);

  await service.executeExperiment(config.experimentId);

  // Since executeExperiment is asynchronous at the Service layer, 
  // the CLI must poll until completion to keep the process alive.
  while (true) {
    const meta = await service.getExperiment(config.experimentId);
    if (meta.status === 'completed' || meta.status === 'failed' || meta.status === 'cancelled') {
      console.log(`\n[Orchestrator] Experiment finished with status: ${meta.status}`);
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}
