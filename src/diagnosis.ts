import { ExperimentRecord, Observation } from './types';

export type Classification = 
  | 'STABLE'
  | 'INTERMITTENT'
  | 'CONDITION_SENSITIVE'
  | 'ENVIRONMENT_SENSITIVE'
  | 'ORDER_SENSITIVE'
  | 'CONCURRENCY_SENSITIVE'
  | 'DETERMINISTIC_FAILURE'
  | 'PROCESS_FAILURE'
  | 'INSUFFICIENT_EVIDENCE';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface ConditionMetrics {
  conditionId: string;
  totalRuns: number;
  passes: number;
  failures: number;
  processFailures: number;
  timeouts: number;
  passRate: number;
  failureRate: number;
  errorHashes: Record<string, number>;
  dominantHash?: string;
  dominantHashFrequency: number;
}

export interface DiagnosisResult {
  experimentId: string;
  target: string;
  classification: Classification;
  confidence: Confidence;
  summary: string;
  evidence: {
    conditionMetrics: ConditionMetrics[];
    totalObservations: number;
    explanation: string[];
  };
  limitations: string;
}

export function analyzeExperiment(config: import('./types').ExperimentConfig, observations: Observation[]): DiagnosisResult {
  const metricsMap = new Map<string, ConditionMetrics>();
  let totalValidRuns = 0;
  let totalProcessErrors = 0;

  // Group observations by logical run (conditionId + runNumber)
  const logicalRuns = new Map<string, Observation[]>();
  for (const obs of observations) {
    const key = `${obs.conditionId}-${obs.runNumber}`;
    if (!logicalRuns.has(key)) logicalRuns.set(key, []);
    logicalRuns.get(key)!.push(obs);
  }

  // 1. Aggregate metrics per logical run (not per individual attempt)
  for (const [logicalRunKey, attempts] of logicalRuns.entries()) {
    // Sort attempts by startedAt ascending (or assume observation order is chronological)
    attempts.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    
    // The final attempt represents the logical outcome
    const finalObs = attempts[attempts.length - 1];
    
    if (!metricsMap.has(finalObs.conditionId)) {
      metricsMap.set(finalObs.conditionId, {
        conditionId: finalObs.conditionId,
        totalRuns: 0, passes: 0, failures: 0, processFailures: 0, timeouts: 0,
        passRate: 0, failureRate: 0, errorHashes: {}, dominantHashFrequency: 0
      });
    }
    const metrics = metricsMap.get(finalObs.conditionId)!;
    metrics.totalRuns++;

    if (finalObs.processStatus === 'process_failure') {
      metrics.processFailures++;
      totalProcessErrors++;
    } else if (finalObs.processStatus === 'timeout') {
      metrics.timeouts++;
      totalProcessErrors++;
    } else if (finalObs.processStatus === 'success') {
      metrics.passes++;
      totalValidRuns++;
    } else if (finalObs.processStatus === 'test_failure') {
      metrics.failures++;
      totalValidRuns++;
      
      // Track error hashes for failures
      for (const tr of finalObs.testResults) {
        if (tr.status === 'failed' && tr.errorHash) {
          metrics.errorHashes[tr.errorHash] = (metrics.errorHashes[tr.errorHash] || 0) + 1;
        }
      }
    }
  }

  // 2. Compute rates and dominant hashes
  const allMetrics = Array.from(metricsMap.values());
  for (const m of allMetrics) {
    const validRuns = m.passes + m.failures;
    m.passRate = validRuns > 0 ? m.passes / validRuns : 0;
    m.failureRate = validRuns > 0 ? m.failures / validRuns : 0;

    let maxHashCount = 0;
    for (const [hash, count] of Object.entries(m.errorHashes)) {
      if (count > maxHashCount) {
        maxHashCount = count;
        m.dominantHash = hash;
      }
    }
    // Calculate how often the dominant hash occurs across all failed assertions in this condition
    const totalHashes = Object.values(m.errorHashes).reduce((a, b) => a + b, 0);
    m.dominantHashFrequency = totalHashes > 0 ? maxHashCount / totalHashes : 0;
  }

  const explanation: string[] = [];
  let classification: Classification = 'INSUFFICIENT_EVIDENCE';
  let confidence: Confidence = 'INSUFFICIENT';

  // 3. Heuristic Classification Rules
  if (totalValidRuns < 3) {
    if (totalProcessErrors >= 3) {
      classification = 'PROCESS_FAILURE';
      explanation.push('Process failures or timeouts dominated the executions, preventing meaningful test observation.');
      confidence = 'HIGH';
    } else {
      explanation.push(`Only ${totalValidRuns} valid runs recorded. Insufficient evidence to confidently classify behavior.`);
    }
  } else {
    // Find min and max failure rates
    let minFailRate = 1.0;
    let maxFailRate = 0.0;
    let mostFailingCondition = allMetrics[0];

    for (const m of allMetrics) {
      if (m.failureRate < minFailRate) minFailRate = m.failureRate;
      if (m.failureRate > maxFailRate) {
        maxFailRate = m.failureRate;
        mostFailingCondition = m;
      }
    }

    const maxDelta = maxFailRate - minFailRate;

    // Rule A: High Sensitivity across conditions
    if (maxDelta >= 0.6) {
      explanation.push(`Failure rate jumped significantly (delta: ${(maxDelta*100).toFixed(0)}%) between conditions.`);
      
      // Semantic mapping from metadata if available, else generic
      const cid = mostFailingCondition.conditionId;
      const conditionDef = config.conditionDefs?.[cid];
      const semanticType = conditionDef?.type;

      if (semanticType === 'concurrency') {
        classification = 'CONCURRENCY_SENSITIVE';
        explanation.push('Experiment metadata indicates the condition associated with this jump involves concurrency controls.');
      } else if (semanticType === 'order') {
        classification = 'ORDER_SENSITIVE';
        explanation.push('Experiment metadata indicates the condition associated with this jump involves test execution order.');
      } else if (semanticType === 'environment') {
        classification = 'ENVIRONMENT_SENSITIVE';
        explanation.push('Experiment metadata indicates the condition associated with this jump involves environmental changes.');
      } else {
        classification = 'CONDITION_SENSITIVE';
        explanation.push(`The test is highly sensitive to the '${cid}' condition, but no semantic metadata was provided.`);
      }

      if (mostFailingCondition.dominantHashFrequency >= 0.8) {
        explanation.push(`Failure fingerprint is highly consistent (${(mostFailingCondition.dominantHashFrequency*100).toFixed(0)}% share hash ${mostFailingCondition.dominantHash}).`);
      } else if (mostFailingCondition.failures > 0) {
        explanation.push('Failure fingerprints varied, suggesting multiple failure modes or volatile stack traces.');
      }

      // Confidence
      if (totalValidRuns >= 10 && maxDelta >= 0.8) {
        confidence = 'HIGH';
      } else if (totalValidRuns >= 5 && maxDelta >= 0.6) {
        confidence = 'MEDIUM';
      } else {
        confidence = 'LOW';
      }
    } 
    // Rule B: Intermittent without strong condition difference
    else if (maxFailRate > 0 && maxFailRate < 1.0) {
      classification = 'INTERMITTENT';
      explanation.push(`Test failed intermittently (max failure rate ${(maxFailRate*100).toFixed(0)}%) across conditions without a strong differential trigger.`);
      
      if (totalValidRuns >= 15) confidence = 'HIGH';
      else if (totalValidRuns >= 8) confidence = 'MEDIUM';
      else confidence = 'LOW';
    } 
    // Rule C: Deterministic Failure
    else if (minFailRate === 1.0) {
      classification = 'DETERMINISTIC_FAILURE';
      explanation.push('Test failed deterministically 100% of the time across all observed conditions.');
      
      if (totalValidRuns >= 5) confidence = 'HIGH';
      else confidence = 'MEDIUM';
    }
    // Rule D: Stable
    else if (maxFailRate === 0.0) {
      classification = 'STABLE';
      explanation.push('Test passed 100% of the time across all observed conditions.');
      
      if (totalValidRuns >= 5) confidence = 'HIGH';
      else confidence = 'MEDIUM';
    }
  }

  let summary = `The test is classified as ${classification}.`;
  if (confidence === 'INSUFFICIENT') {
    summary = 'Not enough valid evidence to determine behavior.';
  } else if (confidence === 'HIGH') {
    summary = `Strong evidence indicates the test is ${classification}.`;
  }

  return {
    experimentId: config.experimentId,
    target: config.target,
    classification,
    confidence,
    summary,
    evidence: {
      conditionMetrics: allMetrics,
      totalObservations: observations.length,
      explanation
    },
    limitations: 'This establishes a statistical association based on available observations. It does not prove the source-level root cause, nor does it guarantee the absence of other latent flakiness mechanisms.'
  };
}
