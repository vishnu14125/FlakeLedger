import * as path from 'path';
import { ExperimentConfig } from './types';

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const MAX_TARGET_LENGTH = 1024;
const MAX_PATH_LENGTH = 4096;
const MAX_CONDITIONS = 64;
const MAX_ID_LENGTH = 128;
const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4096;
const MAX_ENV_VARS = 128;
const MAX_ENV_VALUE_LENGTH = 32768;

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Server-side validation of an experiment configuration.
 *
 * This is the trust boundary for everything the worker will later execute:
 * `target`, `projectPath`, `condition.args` and `condition.env` become the
 * runner's working directory, arguments and environment. The dashboard applies
 * stricter, friendlier checks, but they are advisory — this function is the one
 * that decides.
 */
export function validateExperimentConfig(config: any): asserts config is ExperimentConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Config must be an object');
  }

  if (typeof config.experimentId !== 'string' || !config.experimentId.trim()) {
    throw new Error('experimentId must be a non-empty string');
  }
  if (!/^[a-zA-Z0-9-_]+$/.test(config.experimentId)) {
    throw new Error('experimentId contains invalid characters');
  }
  if (typeof config.target !== 'string' || !config.target.trim()) {
    throw new Error('target must be a non-empty string');
  }
  if (config.target.length > MAX_TARGET_LENGTH || CONTROL_CHARS.test(config.target)) {
    throw new Error(`target must be at most ${MAX_TARGET_LENGTH} characters with no control characters`);
  }
  if (typeof config.projectPath !== 'string' || !config.projectPath.trim()) {
    throw new Error('projectPath must be a non-empty string');
  }
  if (config.projectPath.length > MAX_PATH_LENGTH || CONTROL_CHARS.test(config.projectPath)) {
    throw new Error('projectPath must not contain control characters');
  }
  if (!path.isAbsolute(config.projectPath)) {
    throw new Error('projectPath must be an absolute path');
  }
  if (typeof config.runsPerCondition !== 'number' || config.runsPerCondition < 1 || config.runsPerCondition > 1000) {
    throw new Error('runsPerCondition must be a number between 1 and 1000');
  }
  if (typeof config.timeoutMs !== 'number' || config.timeoutMs < 100 || config.timeoutMs > 3600000) {
    throw new Error('timeoutMs must be a number between 100 and 3600000 (1 hour)');
  }
  if (config.concurrency !== undefined && (typeof config.concurrency !== 'number' || config.concurrency < 1 || config.concurrency > 64)) {
    throw new Error('concurrency must be between 1 and 64');
  }
  if (config.retryPolicy !== undefined) {
    if (typeof config.retryPolicy !== 'object' || typeof config.retryPolicy.maxRetries !== 'number' || config.retryPolicy.maxRetries < 0 || config.retryPolicy.maxRetries > 10) {
      throw new Error('retryPolicy.maxRetries must be between 0 and 10');
    }
  }
  if (config.argsFormat !== undefined && config.argsFormat !== 'argv') {
    throw new Error("argsFormat must be 'argv' when provided");
  }

  if (!Array.isArray(config.conditions) || config.conditions.length === 0) {
    throw new Error('conditions must be a non-empty array of strings');
  }
  if (config.conditions.length > MAX_CONDITIONS) {
    throw new Error(`conditions must contain at most ${MAX_CONDITIONS} entries`);
  }

  if (!config.conditionDefs || typeof config.conditionDefs !== 'object' || Array.isArray(config.conditionDefs)) {
    throw new Error('conditionDefs must be an object');
  }

  for (const c of config.conditions) {
    if (typeof c !== 'string') throw new Error('Condition names must be strings');
    if (c.length === 0 || c.length > MAX_ID_LENGTH || CONTROL_CHARS.test(c)) {
      throw new Error('Condition ids must be 1-128 characters with no control characters');
    }
    // Own-property lookup: `conditionDefs['constructor']` must not resolve.
    if (!hasOwn(config.conditionDefs, c)) throw new Error(`Missing definition for condition: ${c}`);
    const def = config.conditionDefs[c];
    if (!def || typeof def !== 'object') throw new Error(`Missing definition for condition: ${c}`);
    if (def.id !== c) throw new Error(`Condition id mismatch for ${c}`);
    if (typeof def.name !== 'string') throw new Error(`Condition name must be string for ${c}`);

    if (def.env !== undefined && def.env !== null) {
      if (typeof def.env !== 'object' || Array.isArray(def.env)) {
        throw new Error(`Condition env must be an object for ${c}`);
      }
      const entries = Object.entries(def.env);
      if (entries.length > MAX_ENV_VARS) throw new Error(`Condition env has too many variables for ${c}`);
      for (const [key, value] of entries) {
        if (!ENV_NAME.test(key) || key === '__proto__') {
          throw new Error(`Condition env contains an invalid variable name for ${c}`);
        }
        if (typeof value !== 'string' || value.length > MAX_ENV_VALUE_LENGTH || value.includes('\u0000')) {
          throw new Error(`Condition env values must be strings without NUL for ${c} (${key})`);
        }
      }
    }

    if (def.args !== undefined && def.args !== null) {
      if (!Array.isArray(def.args)) throw new Error(`Condition args must be an array for ${c}`);
      if (def.args.length > MAX_ARGS) throw new Error(`Condition has too many args for ${c}`);
      for (const arg of def.args) {
        if (typeof arg !== 'string' || arg.length > MAX_ARG_LENGTH || arg.includes('\u0000')) {
          throw new Error(`Condition args must be strings without NUL for ${c}`);
        }
      }
    }
  }
}
