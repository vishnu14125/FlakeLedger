/**
 * FlakeLedger - CLI & Core Engine
 */
import { TestResult, ExperimentConfig, Observation } from './types';
import { parseVitestJson } from './parser';
import { analyzeExperiment, Classification, Confidence, DiagnosisResult } from './diagnosis';
import { validateExperimentConfig } from './validator';
import { IExperimentRepository } from './repository';
import { LocalFileExperimentRepository } from './local-repository';
import { PostgresExperimentRepository } from './postgres-repository';

export {
  TestResult,
  ExperimentConfig,
  Observation,
  parseVitestJson,
  analyzeExperiment,
  validateExperimentConfig,
  IExperimentRepository,
  LocalFileExperimentRepository,
  PostgresExperimentRepository
};

export function main() {
  console.log("FlakeLedger CLI initialized.");
  console.log("Core types, parsers, diagnosis engine, and persistence loaded.");
}

if (require.main === module) {
  main();
}
