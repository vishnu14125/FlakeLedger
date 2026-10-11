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
import { BoundedCapture, MAX_TERMINAL_OUTPUT_BYTES, MAX_PARSER_BYTES } from './orchestrator/capture';

export {
  TestResult,
  ExperimentConfig,
  Observation,
  parseVitestJson,
  analyzeExperiment,
  validateExperimentConfig,
  IExperimentRepository,
  LocalFileExperimentRepository,
  PostgresExperimentRepository,
  BoundedCapture,
  MAX_TERMINAL_OUTPUT_BYTES,
  MAX_PARSER_BYTES
};

export function main() {
  console.log("FlakeLedger CLI initialized.");
  console.log("Core types, parsers, diagnosis engine, persistence, and evidence capture loaded.");
}

if (require.main === module) {
  main();
}
