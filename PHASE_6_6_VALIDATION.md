# PHASE 6.6 VALIDATION REPORT

## 1. Objective
Harden Phase 6 to accurately model execution retries as evidence, ensure correct Windows process lifecycle handling (timeouts, cancellation), prevent double-resolution races, and verify accurate diagnosis aggregation.

## 2. Starting Architecture
Phase 6 abstracted process execution via `ExperimentPlanner`, `ExecutionScheduler`, and `ExecutionWorker`. However, intermediate infrastructure retry attempts were silently dropped in favor of the final attempt, erasing valid test execution evidence.

## 3. Issues Discovered
- **Retry Evidence Loss**: `Scheduler` previously discarded `process_failure` objects immediately during its `while (true)` retry loop.
- **Diagnosis Aggregation**: The Phase 3 `Diagnosis Engine` natively aggregated flat runs. By preserving retry attempts (same `runNumber`), it risked over-counting attempts as independent runs.
- **Timeout Race**: `worker.ts` lacked a `.on('error')` hook, risking a hanging promise if Vitest failed to spawn entirely.
- **Resource Exhaustion (Vitest-in-Vitest)**: Running `vitest` recursively inside the `vitest` test suite caused severe `process_failure` crashes when threads competed for memory and port locks.

## 4. Changes Made
- Upgraded `ExecutionTask` and `observationId` to append `attemptNumber` dynamically from the Scheduler (`exp-cond-run-attempt`).
- Scheduler now performs immediate, incremental persistence of `obs` *inside* the retry loop, capturing every single spawn attempt.
- Added a `child.on('error')` binding to the Worker process to guarantee promise resolution if Windows spawn throws synchronously.
- Bound Vitest's parent test suite `maxForks: 2` using `pool: 'forks'` to resolve recursive memory constraints on real-child execution tests.

## 5. Retry Evidence Model
**VERIFIED**. An adversarial test proves that a `process_failure` followed by a successful retry results in exactly 2 distinct observations saved in the repository for the same `runNumber` (e.g. `run-1-1` and `run-1-2`). 
Test failures and timeouts explicitly do NOT trigger retries.

## 6. Timeout Lifecycle Validation
**VERIFIED**. A real child process running an infinite sleep (`hang.test.ts`) was executed by `ExecutionWorker`. The timeout triggered successfully via `child.kill('SIGKILL')`, forced the worker state to `timeout`, and immediately resolved the Promise to unblock the scheduler.

## 7. Cancellation Validation
**VERIFIED**. An adversarial integration test spawns a real test via Scheduler, waits 1500ms, and calls `scheduler.cancel()`. The `AbortController` triggers cleanly, the Worker aborts, and exactly 1 observation is persisted with `processStatus: 'cancelled'`. The loop correctly halts.

## 8. Windows Validation
**VERIFIED**. The `child.kill('SIGKILL')` on Windows successfully halts the direct immediate spawned `npx` wrapper. The Worker promise manually resolves to prevent Node from hanging on zombie pipe closures. Orphan descendant `vitest` processes may technically remain alive in the background on Windows, which is a known Node.js platform limitation for deeply nested detached children without a tree-kill package.

## 9. Race-Condition Validation
**VERIFIED**. Adding the `child.on('error')` guard alongside `.on('close')` and the internal `processStatus` lock explicitly protects against double-promise resolution.

## 10. Environment Isolation
**VERIFIED**. The integration test verifies that `TEST_VAL=A` and `TEST_VAL=B` injected concurrently into separate Worker spawns do not leak. The documentation phrasing has been correctly softened to "Validated per-child environment isolation for concurrent Node/Vitest executions."

## 11. Diagnosis Compatibility
**VERIFIED**. The `Diagnosis Engine` (`analyzeExperiment`) was refactored to correctly perform a `.reduce`/grouping by `conditionId-runNumber`. It now sorts attempts chronologically and evaluates the *final* outcome of the logical run for pass/fail classification, preventing attempt inflation.

## 12. Migration / Backward Compatibility
**VERIFIED**. Existing Phase 4 local files and Phase 5 Postgres setups seamlessly accept the new string structure of `observationId` since the primary keys remain text fields.

## 13. Test Results
- Full test suite execution: **52 tests passed** (0 failed).
- All adversarial orchestration, retry, timeout, and cancellation validations complete successfully.

## 14. Performance Wording
Local measurements showed substantial reduction in wall-clock execution time as worker concurrency increased from 1 to 4.

## 15. Remaining Limitations
- Deeply nested child processes spawned by tests on Windows might occasionally orphan if they ignore standard SIGKILL propagation.
- Vitest-in-Vitest test execution requires strict pool management to prevent CI out-of-memory errors.

## 16. Final Verdict
**PASS**
