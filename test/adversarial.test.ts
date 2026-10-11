import { expect, test, describe } from 'vitest';
import { analyzeExperiment } from '../src/diagnosis';
import { ExperimentRecord, Observation } from '../src/types';

function createMockExperiment(observations: Partial<Observation>[], defs: any = {}): ExperimentRecord {
  const counts = new Map<string, number>();
  for (let i = 0; i < observations.length; i++) {
    const o = { ...observations[i] };
    observations[i] = o;
    const c = o.conditionId || 'baseline';
    counts.set(c, (counts.get(c) || 0) + 1);
    o.runNumber = counts.get(c);
    if (!o.startedAt) o.startedAt = `2023-01-01T00:00:${i.toString().padStart(2, '0')}Z`;
    if (!o.testResults) o.testResults = [];
  }

  return {
    experimentId: 'TEST-EXP',
    config: {
      experimentId: 'TEST-EXP',
      target: 'test.ts',
      projectPath: '/',
      runsPerCondition: observations.length,
      conditionDefs: defs,
      conditions: [],
      timeoutMs: 30000
    },
    observations: observations as Observation[],
    summary: {}
  };
}

describe('Adversarial & Generalization Tests', () => {
  test('Opaque condition IDs with semantic metadata resolve correctly', () => {
    const obs = [
      ...Array(20).fill({ conditionId: 'control', processStatus: 'success' }),
      ...Array(20).fill({ conditionId: 'variant-X', processStatus: 'test_failure', testResults: [] })
    ];
    const defs = { 'variant-X': { type: 'concurrency' } };
    const exp = createMockExperiment(obs, defs);
    const result = analyzeExperiment(exp.config, exp.observations);
    expect(result.classification).toBe('CONCURRENCY_SENSITIVE');
    expect(result.confidence).toBe('HIGH');
  });

  test('Renaming target filename does not change output', () => {
    const obs = [
      ...Array(10).fill({ conditionId: 'base', processStatus: 'success' }),
      ...Array(10).fill({ conditionId: 'mut', processStatus: 'test_failure', testResults: [] })
    ];
    const exp1 = createMockExperiment(obs);
    const r1 = analyzeExperiment(exp1.config, exp1.observations);
    
    const exp2 = createMockExperiment(obs);
    exp2.config.target = 'totally-different-name.test.ts';
    const r2 = analyzeExperiment(exp2.config, exp2.observations);
    
    expect(r1.classification).toEqual(r2.classification);
    expect(r1.confidence).toEqual(r2.confidence);
    expect(r1.classification).toBe('CONDITION_SENSITIVE');
  });

  test('Reordering conditions does not change output', () => {
    const obsA = [
      ...Array(10).fill({ conditionId: 'C1', processStatus: 'success' }),
      ...Array(10).fill({ conditionId: 'C2', processStatus: 'test_failure', testResults: [] })
    ];
    const obsB = [
      ...Array(10).fill({ conditionId: 'C2', processStatus: 'test_failure', testResults: [] }),
      ...Array(10).fill({ conditionId: 'C1', processStatus: 'success' })
    ];
    const defs = { 'C2': { type: 'order' } };
    
    const exp1 = createMockExperiment(obsA, defs);
    const r1 = analyzeExperiment(exp1.config, exp1.observations);
    
    const exp2 = createMockExperiment(obsB, defs);
    const r2 = analyzeExperiment(exp2.config, exp2.observations);
    
    expect(r1.classification).toEqual(r2.classification);
    expect(r1.classification).toBe('ORDER_SENSITIVE');
  });

  test('Sample size thresholds validation', () => {
    const defs = { 'mut': { type: 'environment' } };

    const obs1 = [
      { conditionId: 'base', processStatus: 'success' },
      { conditionId: 'mut', processStatus: 'test_failure', testResults: [] }
    ];
    const exp1 = createMockExperiment(obs1, defs);
    expect(analyzeExperiment(exp1.config, exp1.observations).classification).toBe('INSUFFICIENT_EVIDENCE');

    const obs3 = [
      ...Array(2).fill({ conditionId: 'base', processStatus: 'success' }),
      ...Array(2).fill({ conditionId: 'mut', processStatus: 'test_failure', testResults: [] })
    ];
    const exp3 = createMockExperiment(obs3, defs);
    expect(analyzeExperiment(exp3.config, exp3.observations).confidence).toBe('LOW');

    const obs10 = [
      ...Array(10).fill({ conditionId: 'base', processStatus: 'success' }),
      ...Array(10).fill({ conditionId: 'mut', processStatus: 'test_failure', testResults: [] })
    ];
    const exp10 = createMockExperiment(obs10, defs);
    expect(analyzeExperiment(exp10.config, exp10.observations).confidence).toBe('HIGH');
  });

  test('Effect size thresholds validation', () => {
    const defs = { 'mut': { type: 'environment' } };

    const obsHigh = [
      ...Array(20).fill({ conditionId: 'base', processStatus: 'success' }),
      ...Array(20).fill({ conditionId: 'mut', processStatus: 'test_failure', testResults: [] })
    ];
    const expHigh = createMockExperiment(obsHigh, defs);
    expect(analyzeExperiment(expHigh.config, expHigh.observations).confidence).toBe('HIGH');

    const obsMed = [
      ...Array(20).fill({ conditionId: 'base', processStatus: 'success' }),
      ...Array(7).fill({ conditionId: 'mut', processStatus: 'success' }),
      ...Array(13).fill({ conditionId: 'mut', processStatus: 'test_failure', testResults: [] })
    ];
    const expMed = createMockExperiment(obsMed, defs);
    expect(analyzeExperiment(expMed.config, expMed.observations).confidence).toBe('MEDIUM');

    const obsLow = [
      ...Array(18).fill({ conditionId: 'base', processStatus: 'success' }),
      ...Array(2).fill({ conditionId: 'base', processStatus: 'test_failure', testResults: [] }),
      ...Array(16).fill({ conditionId: 'mut', processStatus: 'success' }),
      ...Array(4).fill({ conditionId: 'mut', processStatus: 'test_failure', testResults: [] })
    ];
    const expLow = createMockExperiment(obsLow, defs);
    expect(analyzeExperiment(expLow.config, expLow.observations).classification).toBe('INTERMITTENT');
  });

  test('Small-sample ambiguity', () => {
    const obs = [
      ...Array(2).fill({ conditionId: 'base', processStatus: 'success' }),
      ...Array(1).fill({ conditionId: 'base', processStatus: 'test_failure', testResults: [] }),
      ...Array(1).fill({ conditionId: 'mut', processStatus: 'success' }),
      ...Array(2).fill({ conditionId: 'mut', processStatus: 'test_failure', testResults: [] })
    ];
    const exp = createMockExperiment(obs);
    const r = analyzeExperiment(exp.config, exp.observations);
    expect(r.classification).toBe('INTERMITTENT');
    expect(r.confidence).toBe('LOW');
  });

  test('Fingerprint validation - same behavior, different hashes', () => {
    const obs = [
      ...Array(10).fill({ conditionId: 'base', processStatus: 'success' }),
      ...Array(5).fill({ conditionId: 'mut', processStatus: 'test_failure', testResults: [{ status: 'failed', errorHash: 'H1' }] }),
      ...Array(5).fill({ conditionId: 'mut', processStatus: 'test_failure', testResults: [{ status: 'failed', errorHash: 'H2' }] })
    ];
    const exp = createMockExperiment(obs);
    const r = analyzeExperiment(exp.config, exp.observations);
    expect(r.classification).toBe('CONDITION_SENSITIVE');
    expect(r.evidence.explanation.join(' ')).toContain('varied, suggesting multiple failure modes');
  });

  test('Competing conditions', () => {
    const obs = [
      ...Array(20).fill({ conditionId: 'baseline', processStatus: 'success' }),
      ...Array(20).fill({ conditionId: 'variant-A', processStatus: 'test_failure', testResults: [] }),
      ...Array(20).fill({ conditionId: 'variant-B', processStatus: 'test_failure', testResults: [] })
    ];
    const exp = createMockExperiment(obs);
    const r = analyzeExperiment(exp.config, exp.observations);
    expect(r.classification).toBe('CONDITION_SENSITIVE');
  });
});
