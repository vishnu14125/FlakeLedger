import { ExperimentConfig, Condition } from './types';

export function validateExperimentConfig(config: any): asserts config is ExperimentConfig {
  if (!config || typeof config !== 'object') {
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
  if (typeof config.projectPath !== 'string' || !config.projectPath.trim()) {
    throw new Error('projectPath must be a non-empty string');
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

  if (!Array.isArray(config.conditions) || config.conditions.length === 0) {
    throw new Error('conditions must be a non-empty array of strings');
  }

  if (!config.conditionDefs || typeof config.conditionDefs !== 'object') {
    throw new Error('conditionDefs must be an object');
  }

  for (const c of config.conditions) {
    if (typeof c !== 'string') throw new Error('Condition names must be strings');
    const def = config.conditionDefs[c];
    if (!def) throw new Error(`Missing definition for condition: ${c}`);
    if (def.id !== c) throw new Error(`Condition id mismatch for ${c}`);
    if (typeof def.name !== 'string') throw new Error(`Condition name must be string for ${c}`);
    if (def.env && typeof def.env !== 'object') throw new Error(`Condition env must be an object for ${c}`);
    if (def.args && !Array.isArray(def.args)) throw new Error(`Condition args must be an array for ${c}`);
  }
}
