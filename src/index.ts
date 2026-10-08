/**
 * FlakeLedger - CLI & Core Engine
 */
import { TestResult, ExperimentConfig, Observation } from './types';
import { parseVitestJson } from './parser';

export {
  TestResult,
  ExperimentConfig,
  Observation,
  parseVitestJson
};

export function main() {
  console.log("FlakeLedger CLI initialized.");
  console.log("Core types and parsers loaded.");
}

if (require.main === module) {
  main();
}
