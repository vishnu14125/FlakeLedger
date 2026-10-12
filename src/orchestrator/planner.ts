import { ExperimentConfig, Observation } from '../types';

export interface ExecutionTask {
  experimentId: string;
  conditionId: string;
  runNumber: number;
  attemptNumber?: number;
}

/**
 * Identity of a logical run within one experiment.
 *
 * A logical run is (conditionId, runNumber). It is NOT an observation id: the
 * worker stores one observation per *attempt*, suffixing the attempt number
 * (`<experimentId>-<conditionId>-<runNumber>-<attempt>`), so a retried run owns
 * several observation ids. Resume therefore has to compare logical-run identity,
 * built from the fields every Observation already carries, rather than
 * reconstructing an id string the worker never writes.
 *
 * The experiment id stays in the key so observations belonging to another
 * experiment can never mark a run complete, which the previous hyphen-joined key
 * enforced implicitly. The NUL separator keeps the key unambiguous for condition
 * ids that themselves contain the separator characters used elsewhere (e.g.
 * `order-seed-3`).
 */
function logicalRunKey(experimentId: string, conditionId: string, runNumber: number): string {
  return `${experimentId}\u0000${conditionId}\u0000${runNumber}`;
}

export class ExperimentPlanner {
  public static plan(config: ExperimentConfig, existingObservations: Observation[] = []): ExecutionTask[] {
    const tasks: ExecutionTask[] = [];
    // One entry per logical run already on record, regardless of how many
    // attempts it took.
    const recordedRuns = new Set(
      existingObservations.map(o => logicalRunKey(o.experimentId, o.conditionId, o.runNumber))
    );

    for (const conditionId of config.conditions) {
      if (!config.conditionDefs[conditionId]) {
        throw new Error(`Condition ${conditionId} not defined in config.conditionDefs`);
      }
      for (let runNumber = 1; runNumber <= config.runsPerCondition; runNumber++) {
        if (!recordedRuns.has(logicalRunKey(config.experimentId, conditionId, runNumber))) {
          tasks.push({
            experimentId: config.experimentId,
            conditionId,
            runNumber
          });
        }
      }
    }

    return tasks;
  }
}
