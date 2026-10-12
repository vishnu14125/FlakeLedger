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
import { ExperimentPlanner, ExecutionTask } from './orchestrator/planner';
import { ExecutionWorker } from './orchestrator/worker';
import { ExecutionScheduler } from './orchestrator/scheduler';
import { runExperiment } from './orchestrator/index';
import { ExperimentService } from './service';
import { createApi, ApiOptions } from './api';
import { ApiExperimentRepository } from './api-repository';
import { resolveServerConfig, ServerConfig } from './server-config';

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
  MAX_PARSER_BYTES,
  ExperimentPlanner,
  ExecutionTask,
  ExecutionWorker,
  ExecutionScheduler,
  runExperiment,
  ExperimentService,
  createApi,
  ApiOptions,
  ApiExperimentRepository,
  resolveServerConfig,
  ServerConfig
};

export function main() {
  console.log("FlakeLedger CLI initialized.");
  console.log("Core types, parsers, diagnosis engine, persistence, execution orchestrator, service layer, and HTTP API loaded.");
}

if (require.main === module) {
  main();
}
