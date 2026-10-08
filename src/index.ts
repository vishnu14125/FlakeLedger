/**
 * FlakeLedger - CLI & Core Engine
 */
import { TestResult, ExperimentConfig, Observation } from './types';
import { parseVitestJson } from './parser';
import { analyzeExperiment, Classification, Confidence, DiagnosisResult } from './diagnosis';
import { validateExperimentConfig } from './validator';

export {
  TestResult,
  ExperimentConfig,
  Observation,
  parseVitestJson,
  analyzeExperiment,
  validateExperimentConfig
};

export function main() {
  console.log("FlakeLedger CLI initialized.");
  console.log("Core types, parsers, and diagnosis engine loaded.");
}

if (require.main === module) {
  main();
}
