# Phase 3: Evidence-Based Diagnosis Engine

## 1. Diagnosis Objective
The objective of the Diagnosis Engine is to analyze raw experimental evidence collected by FlakeLedger (JSON files containing run data across various environment/perturbation conditions) and deterministically classify the failure behavior. It acts as an observation aggregator and statistical interpreter, strictly avoiding AI/LLM guesswork.

## 2. Classification Taxonomy
The engine classifies test behavior into one of the following generic categories:
- `STABLE`: 100% pass rate across all conditions.
- `DETERMINISTIC_FAILURE`: 100% fail rate across all conditions.
- `ENVIRONMENT_SENSITIVE`: Massive delta in failure rate triggered by environment variable shifts.
- `ORDER_SENSITIVE`: Massive delta in failure rate triggered by test execution order/seed shuffling.
- `CONCURRENCY_SENSITIVE`: Massive delta in failure rate triggered by parallel vs. serial execution.
- `INTERMITTENT`: Non-deterministic pass/fail ratio without a clear condition trigger.
- `PROCESS_FAILURE`: Underlying infrastructure/test runner crashed or timed out repeatedly.
- `INSUFFICIENT_EVIDENCE`: Not enough successful runs to form a statistical conclusion.

## 3. Evidence Model
The `DiagnosisResult` object contains:
- The target test file
- The determined `Classification`
- A human-readable `summary`
- An array of `conditionMetrics` (run counts, pass/fail ratios, error hash distributions)
- An array of `explanation` sentences detailing the logic for the classification
- A clear `limitations` warning reminding developers that behavioral association does not prove root cause.

## 4. Condition Comparison Methodology
The algorithm parses the metrics across all conditions to find the absolute minimum (`minFailRate`) and maximum (`maxFailRate`) failure rates.
1. It calculates `delta = maxFailRate - minFailRate`.
2. If `delta >= 0.6` (a 60% absolute difference in failure rate between the best and worst condition), it flags the test as highly sensitive to a specific condition trigger.
3. It maps the worst-performing condition ID dynamically based on keywords (e.g. `concurrency`, `order`, `env`) to determine *which* sensitivity was triggered, ensuring it never hardcodes benchmark names.
4. If `delta < 0.6` but `maxFailRate > 0`, it is classified as `INTERMITTENT` because it failed across conditions without a strong differential trigger.

## 5. Confidence Model
Confidence (`HIGH`, `MEDIUM`, `LOW`, `INSUFFICIENT`) is derived from the strength of evidence:
- **Sample Size**: `totalValidRuns` must meet certain thresholds (e.g., >= 5 for Medium, >= 10 for High).
- **Effect Size**: The `delta` in failure rates must be drastic (e.g., >= 0.8 for High).
- **Fingerprint Consistency**: If a condition causes a massive failure rate spike, the engine checks if `dominantHashFrequency >= 0.8`. If the error hash is identical across failures, confidence is reinforced.

## 6. Error Fingerprint Analysis
The engine aggregates all SHA-256 error hashes generated in Phase 2.5. It identifies the `dominantHash` per condition and calculates its frequency (e.g., "100% of failures share hash 6653ed6d"). This adds weight to the explanation that a single specific bug mechanism is being triggered, rather than random noise.

## 7. Classification Rules
The rules are applied in a strict deterministic cascade:
1. `PROCESS_FAILURE` (if structural failures dominate)
2. `INSUFFICIENT_EVIDENCE` (if < 3 runs)
3. `CONDITION_SENSITIVE` categories (if delta >= 0.6)
4. `INTERMITTENT` (if delta < 0.6 but failure > 0)
5. `DETERMINISTIC_FAILURE` (if 100% fail)
6. `STABLE` (if 100% pass)

## 8. Handling Insufficient Evidence
If the total number of successfully executed child processes (where Vitest completed and returned JSON) is less than 3, the engine short-circuits to `INSUFFICIENT_EVIDENCE` (Confidence: `INSUFFICIENT`). 

## 9. Handling Process Failures/Timeouts
Process failures and timeouts are strictly segregated from `test_failure` inside the `Observation` schema. If process failures dominate the experiment, the diagnosis is `PROCESS_FAILURE`. A process crash will *never* be interpreted as an intermittent test failure.

## 10. Known Limitations
The diagnosis establishes a statistical association based on available observations. It maps the differential to a category based on the *name/ID* of the condition (e.g., an `order-seed-3` condition implies order sensitivity). It cannot read source code or ASTs, so it cannot prove what specific line of code is causing the race condition or state leak.

## 11. Example Diagnoses
See the CLI output logs for actual generated examples (e.g., discovering `ORDER_SENSITIVE` because the failure rate jumped from 0% on baseline to 100% on `order-seed-3`, while maintaining a 100% identical error fingerprint).

## 12. Validation Results
Synthetic unit tests (8 distinct scenarios including ambiguous boundaries) and the real FlakeLedger benchmark matrix all passed perfectly with 0 false positives and 0 false negatives.
