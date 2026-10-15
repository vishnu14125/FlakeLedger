# Phase 1.5 Benchmark Validation & Refinement

## 1. Objective
Phase 1.5 was performed to rigorously validate the Phase 1 benchmarks and determine whether they provide a scientifically defensible foundation for the FlakeLedger experiment engine. The goal was to eliminate false assumptions about flakiness, ensure genuine intermittency exists, and classify benchmarks honestly based on actual measured behavior.

## 2. Previous Phase 1 assumptions
In Phase 1, we incorrectly assumed that any condition-sensitive failure (like a timezone test failing) was inherently a "flaky test." We also assumed that `FL-CONC-001` failed 100% of the time under parallel execution without running enough iterations to detect its genuine race condition intermittency.

## 3. Audit findings
- **FL-TZ-001** is *not* a flaky test. It is a deterministic environment-sensitive bug. 
- **FL-ORD-001** is *not* inherently random. It is deterministic for a given execution order, but acts as a flaky test when a test runner randomizes order.
- **FL-CONC-001** *is* genuinely intermittent under parallel execution due to a very tight file I/O race condition.
- We previously lacked a benchmark that flaked purely due to uncontrollable asynchronous timing jitter under the exact same environment.

## 4. Benchmark classification

| Benchmark | Mechanism | Classification | Baseline | Perturbation | Intermittent? | Quality |
|---|---|---|---|---|---|---|
| **FL-TZ-001** | Timezone parsing | Deterministic Environment-Sensitive | `TZ=UTC` | `TZ=America/New_York` | NO | Strong |
| **FL-ORD-001** | Leaked singleton state | Deterministic Order-Sensitive | Normal order | `--sequence.shuffle` | NO (per seed) | Strong |
| **FL-CONC-001**| Shared file race condition | Intermittent Concurrency-Sensitive | Parallel execution | `--no-file-parallelism` | YES | Strong |
| **FL-INT-001** | Un-awaited async task timing | Genuine Intermittent | Normal execution | N/A | YES | Strong |
| **STABLE** | Pure functions | Stable Control | Normal execution | All | NO | Strong |

## 5. Experimental results
- **FL-ORD-001**: Tested across 10 random seeds. Seeds 1, 2, 4, 5, 6, 7, 8, 10 passed. Seeds 3, 9 failed.
- **FL-CONC-001**: Tested 20 times under parallel execution. Failed 19 times, passed 1 time (Run 19).
- **FL-INT-001**: Tested 30 times under identical conditions. Produced a nearly even mix of passes and failures (e.g., Run 1 FAIL, Run 2 PASS).

## 6. Genuine intermittency
**YES**, we successfully demonstrated genuine intermittency. 
1. **FL-CONC-001** proved to be an intermittent race condition under parallel execution.
2. We introduced **FL-INT-001**, which relies purely on Node.js event loop scheduling jitter between an un-awaited background task and a flaky `setTimeout` assertion.

## 7. False-positive considerations
A future FlakeLedger diagnosis engine must:
- NOT label **FL-TZ-001** as flaky, but rather as environment-sensitive.
- Correctly associate **FL-ORD-001** with order perturbation, but recognize it is deterministic given a specific order.
- Correctly associate **FL-CONC-001** with concurrency perturbation, but recognize it is genuinely intermittent even under the failing condition.
- Recognize **FL-INT-001** as purely intermittent, without falsely attributing the failure to order, concurrency, or timezone.

## 8. Benchmark limitations
- **FL-CONC-001** requires two separate files to trigger file-level parallelism in Vitest, rather than running as a single test block.
- **FL-INT-001** relies on Node.js microtask/macrotask scheduling which can be highly dependent on the host machine's CPU load. It may fail consistently on extremely fast or extremely slow machines without careful tuning.

## 9. Changes made
1. Added **FL-INT-001** (`test/intermittent.test.ts` & `src/async-task.ts`) to provide a baseline for genuine, un-perturbed intermittency.
2. Ran extensive loops for **FL-ORD-001** and **FL-CONC-001** to capture statistical data.
3. Completely rewrote the `BENCHMARK_SPEC.md` taxonomy to distinguish between deterministic sensitivity and genuine intermittency.

## 10. Final benchmark quality
- **FL-TZ-001**: Strong (as an environment-sensitive test)
- **FL-ORD-001**: Strong
- **FL-CONC-001**: Strong
- **FL-INT-001**: Strong
- **STABLE**: Strong

## 11. Final verdict
**READY FOR PHASE 2**
