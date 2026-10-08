import { expect, test, describe } from 'vitest';
import { analyzeExperiment } from '../src/diagnosis';
import { ExperimentRecord, Observation } from '../src/types';

function createMockExperiment(observations: Partial<Observation>[]): ExperimentRecord {
  // Inject runNumbers and default fields to satisfy logical run grouping
  const counts = new Map<string, number>();
  
  for (let i = 0; i < observations.length; i++) {
    const o = { ...observations[i] };
    observations[i] = o;
    const c = o.conditionId || 'baseline';
    counts.set(c, (counts.get(c) || 0) + 1);
    o.runNumber = counts.get(c);
    if (!o.startedAt) o.startedAt = `2023-01-01T00:00:${i.toString().padStart(2, '0')}Z`; // unique timestamps to maintain order!
    if (!o.testResults) o.testResults = [];
  }

  return {
    experimentId: 'TEST-EXP',
    config: {
      experimentId: 'TEST-EXP',
      target: 'test.ts',
      projectPath: '/',
      runsPerCondition: observations.length,
      conditionDefs: {},
      conditions: [],
      timeoutMs: 30000
    },
    observations: observations as Observation[],
    summary: {}
  };
}

describe('Diagnosis Engine', () => {
  test('Case 1 — Stable (20/20 PASS)', () => {
    const obs = Array(20).fill({ conditionId: 'baseline', processStatus: 'success' });
    const result = analyzeExperiment(createMockExperiment(obs).config, obs);
    expect(result.classification).toBe('STABLE');
    expect(result.confidence).toBe('HIGH');
  });

  test('Case 2 — Deterministic failure (20/20 FAIL)', () => {
    const obs = Array(20).fill({ conditionId: 'baseline', processStatus: 'test_failure', testResults: [] });
    const result = analyzeExperiment(createMockExperiment(obs).config, obs);
    expect(result.classification).toBe('DETERMINISTIC_FAILURE');
    expect(result.confidence).toBe('HIGH');
  });

  test('Case 3 — Genuine intermittency (10 PASS, 10 FAIL)', () => {
    const obs = [
      ...Array(10).fill({ conditionId: 'baseline', processStatus: 'success' }),
      ...Array(10).fill({ conditionId: 'baseline', processStatus: 'test_failure', testResults: [] })
    ];
    const result = analyzeExperiment(createMockExperiment(obs).config, obs);
    expect(result.classification).toBe('INTERMITTENT');
    expect(result.confidence).toBe('HIGH');
  });

  test('Case 4 — Generic Condition sensitivity (baseline pass, env fail)', () => {
    const obs = [
      ...Array(20).fill({ conditionId: 'baseline', processStatus: 'success' }),
      ...Array(20).fill({ conditionId: 'env-tz', processStatus: 'test_failure', testResults: [] })
    ];
    const result = analyzeExperiment(createMockExperiment(obs).config, obs);
    expect(result.classification).toBe('CONDITION_SENSITIVE'); // No semantic metadata provided
    expect(result.confidence).toBe('HIGH');
  });

  test('Case 5 — Generic Order sensitivity', () => {
    const obs = [
      ...Array(20).fill({ conditionId: 'baseline', processStatus: 'success' }),
      ...Array(20).fill({ conditionId: 'order-a', processStatus: 'test_failure', testResults: [] }),
      ...Array(20).fill({ conditionId: 'order-b', processStatus: 'test_failure', testResults: [] })
    ];
    const result = analyzeExperiment(createMockExperiment(obs).config, obs);
    expect(result.classification).toBe('CONDITION_SENSITIVE');
    expect(result.confidence).toBe('HIGH');
  });

  test('Case 6 — Generic Concurrency sensitivity', () => {
    const obs = [
      ...Array(18).fill({ conditionId: 'baseline', processStatus: 'success' }),
      ...Array(2).fill({ conditionId: 'baseline', processStatus: 'test_failure', testResults: [] }),
      ...Array(3).fill({ conditionId: 'concurrency-parallel', processStatus: 'success' }),
      ...Array(17).fill({ conditionId: 'concurrency-parallel', processStatus: 'test_failure', testResults: [] }),
      ...Array(20).fill({ conditionId: 'concurrency-serial', processStatus: 'success' })
    ];
    const result = analyzeExperiment(createMockExperiment(obs).config, obs);
    expect(result.classification).toBe('CONDITION_SENSITIVE');
    expect(result.confidence).toBe('HIGH');
  });

  test('Case 7 — Insufficient evidence (1 pass, 1 fail)', () => {
    const obs = [
      { conditionId: 'baseline', processStatus: 'success' },
      { conditionId: 'baseline', processStatus: 'test_failure', testResults: [] }
    ];
    const result = analyzeExperiment(createMockExperiment(obs).config, obs);
    expect(result.classification).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.confidence).toBe('INSUFFICIENT');
  });

  test('Case 8 — Process failures', () => {
    const obs = [
      ...Array(10).fill({ conditionId: 'baseline', processStatus: 'process_failure' }),
      ...Array(10).fill({ conditionId: 'baseline', processStatus: 'timeout' })
    ];
    const result = analyzeExperiment(createMockExperiment(obs).config, obs);
    expect(result.classification).toBe('PROCESS_FAILURE');
    expect(result.confidence).toBe('HIGH');
  });

  test('Ambiguous Case - No strong condition effect', () => {
    const obs = [
      ...Array(10).fill({ conditionId: 'baseline', processStatus: 'success' }),
      ...Array(10).fill({ conditionId: 'baseline', processStatus: 'test_failure', testResults: [] }),
      ...Array(10).fill({ conditionId: 'parallel', processStatus: 'success' }),
      ...Array(10).fill({ conditionId: 'parallel', processStatus: 'test_failure', testResults: [] })
    ];
    const result = analyzeExperiment(createMockExperiment(obs).config, obs);
    // Max fail rate is 0.5, min is 0.5. Delta = 0.
    // Should classify as INTERMITTENT because it's intermittent without strong differential
    expect(result.classification).toBe('INTERMITTENT');
    expect(result.confidence).toBe('HIGH');
  });

  test('Error Fingerprint Consistency', () => {
    const obs = [
      ...Array(10).fill({ conditionId: 'parallel', processStatus: 'test_failure', testResults: [{ status: 'failed', errorHash: 'H1' }] }),
    ];
    const result = analyzeExperiment(createMockExperiment(obs).config, obs);
    expect(result.evidence.conditionMetrics[0].dominantHash).toBe('H1');
    expect(result.evidence.conditionMetrics[0].dominantHashFrequency).toBe(1.0);
  });
});
