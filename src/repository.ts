import { ExperimentMetadata, Observation, ExperimentConfig, PaginatedHistory, ListExperimentsOptions } from './types';
import { DiagnosisResult } from './diagnosis';

export interface IExperimentRepository {
  createExperiment(config: ExperimentConfig): Promise<ExperimentMetadata>;
  getMetadata(experimentId: string): Promise<ExperimentMetadata | null>;
  updateMetadata(experimentId: string, updates: Partial<ExperimentMetadata>): Promise<void>;
  listExperiments(options?: ListExperimentsOptions): Promise<PaginatedHistory>;
  saveObservations(experimentId: string, observations: Observation[]): Promise<void>;
  getObservations(experimentId: string): Promise<Observation[]>;
  getObservationTerminal(experimentId: string, observationId: string): Promise<{stdout?: string, stderr?: string, exitCode?: number | null} | null>;
  saveDiagnosis(experimentId: string, diagnosis: DiagnosisResult): Promise<void>;
  getDiagnosis(experimentId: string): Promise<DiagnosisResult | null>;
}
