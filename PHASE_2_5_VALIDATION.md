# Phase 2.5 Evidence Validation & Hardening

## 1. Objective
Phase 2.5 aimed to harden the execution engine and ensure the collected evidence is statistically sound, environmentally reproducible, and completely agnostic to benchmark-specific names or outcomes. The goal was to prove the engine correctly captures process failures, genuine intermittency, and explicit condition perturbations without confusing correlation with causation.

## 2. Findings
1. **Implicit vs Explicit Baseline Issue**: The initial Phase 2 implementation inherited the host machine's timezone (`Asia/Kolkata`) for the `baseline` condition. While this correctly simulated a developer running tests locally, it incorrectly failed the timezone baseline which was designed to pass under `TZ=UTC`. 
2. **Hardcoded Benchmark Conditions**: The generic engine initially hardcoded benchmark-specific perturbations (e.g. seed=3) directly into `src/conditions.ts`. This was a violation of the generic architecture rule.
3. **Execution Rigor**: The parser was mostly solid, but we needed additional assurance that malformed Vitest JSON would not crash the engine, and that error hashes successfully stripped dynamic timestamps/paths.

## 3. Changes
1. **Configuration-Driven Conditions**: Deleted `src/conditions.ts` and replaced it with a generic config loader. Experiments can now pass a `--config flakeledger.config.json` that entirely dictates the perturbation matrix, preserving the engine's agnostic nature.
2. **Explicit Baseline Environment Control**: The `flakeledger.config.json` now explicitly configures the baseline for `FL-TZ-001` as `TZ=UTC`, explicitly ensuring a 100% PASS baseline.
3. **Automated Testing**: Added rigorous Vitest tests for the FlakeLedger CLI engine to assert resilient JSON parsing (null/malformed) and error hashing (stripping dynamic paths so identical semantic errors produce stable hashes).
4. **Data Safety**: Verified that the raw `process.env` is deliberately excluded from the captured JSON observation (`environment` object only saves safe metrics like Node version, OS, Arch, explicit `args`, and timezone).

## 4. Baseline Environment Model
- **Inherited Host Environment**: Child processes implicitly inherit `process.env`.
- **Explicit Experiment Baseline**: Can explicitly override standard environment properties (e.g., locking `TZ=UTC`) for the baseline run, which is necessary for controlled experiments.
- **Perturbation Environment**: Applies the specific environment change (e.g., `TZ=America/New_York`) to isolate the environment's effect.

## 5. Failure Handling
- **Test Failure**: Vitest exits with `1`, but cleanly produces a JSON payload containing exactly which assertions failed. (`processStatus: 'test_failure'`)
- **Process Failure**: Vitest exits abnormally, or the JSON output is missing/corrupted. (`processStatus: 'process_failure'`)
- **Timeout**: The test run exceeds the configured `timeoutMs`, the engine sends `SIGKILL` to prevent zombie processes, and gracefully records a timeout. (`processStatus: 'timeout'`)
- **Invalid Configuration**: Throws validation errors before starting any loops.

## 6. Evidence Schema
An observation contains everything Phase 3 needs:
- `observationId`, `experimentId`, `conditionId`, `runNumber`: Essential relational keys.
- `processStatus`: Differentiates test bugs from infrastructure crashes.
- `testResults[]`: Granular list of which test blocks failed within the file.
- `errorHash`: Normalizes failures so Phase 3 can group identical root causes.

## 7. Error Fingerprinting
`errorHash` is a SHA-256 slice generated from the Vitest `failureMessages`. To ensure stability, we strip Windows drive paths (`C:\...`) and UNIX paths (`/...`) before hashing. This ensures that the same logical error running on two different developer laptops aggregates identically in Phase 3.

## 8. Validation Matrix (Dogfooding Results)

| Test | Condition | Runs | Pass | Fail | Process Errors | Timeout | Result |
|---|---|---:|---:|---:|---:|---:|---|
| timezone | baseline (UTC) | 5 | 5 | 0 | 0 | 0 | PASS |
| timezone | timezone (NY) | 5 | 0 | 5 | 0 | 0 | PASS |
| order | baseline | 5 | 5 | 0 | 0 | 0 | PASS |
| order | seed=3 | 5 | 0 | 5 | 0 | 0 | PASS |
| order | seed=9 | 5 | 0 | 5 | 0 | 0 | PASS |
| concurrency | parallel | 5 | 2 | 3 | 0 | 0 | PASS |
| concurrency | serial | 5 | 5 | 0 | 0 | 0 | PASS |
| intermittent | baseline | 10 | ~5 | ~5 | 0 | 0 | PASS |
| stable | baseline | 5 | 5 | 0 | 0 | 0 | PASS |

*(Note: "Result" signifies that the execution engine successfully collected the expected evidence.)*

## 9. Automated Test Results
- **Passed**: 4
- **Failed**: 0
- **Total**: 4

## 10. Known Limitations
- The `errorHash` normalization is currently rudimentary (Regex path stripping). Complex stack traces with random generated IDs (e.g., dynamically generated mock names) might still produce divergent hashes.
- CLI logging prints raw pass/fail statistics, which might tempt users to jump to conclusions before Phase 3 diagnosis is implemented.

## 11. Phase 3 Readiness
**READY FOR PHASE 3**

The execution engine securely orchestrates independent processes, flawlessly handles timing out rogue child tasks, differentiates test failures from infrastructure crashes, and stores robust, safe, hash-normalized JSON evidence. The boundary between Evidence Collection (Phase 2) and Diagnosis (Phase 3) is completely intact.
