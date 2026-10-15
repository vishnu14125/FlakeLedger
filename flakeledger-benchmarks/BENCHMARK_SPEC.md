# FlakeLedger Benchmark Specification

## Taxonomy of Behaviors

1. **Category 1 — Stable Control**: Always passes under all tested conditions.
2. **Category 2 — Deterministic Environment-Sensitive**: Consistently passes in one environment, consistently fails in another (e.g., timezone).
3. **Category 3 — Deterministic Order-Sensitive**: Outcome is deterministically tied to the test execution sequence (e.g., seed 3 always fails, seed 1 always passes).
4. **Category 4 — Intermittent Concurrency-Sensitive**: Flakes due to parallel race conditions. Constraining execution serializes it and forces a pass.
5. **Category 5 — Genuine Intermittent**: Flakes unpredictably under the exact same environment and command due to uncontrollable async timing jitter.

---

## Benchmark ID: FL-TZ-001
### Taxonomy Category
`Deterministic Environment-Sensitive`

### Mechanism
`timezone-dependency`

### Hypothesis
The test assumes the local execution timezone matches UTC when formatting a date boundary.

### Baseline
What happens under normal execution? When run with `TZ=UTC`, the test reliably passes.

### Perturbation
What variable do we change? We change the environment variable to `TZ=America/New_York`.

### Observation
The test deterministically fails under the new timezone.

### Interpretation
The failure is explicitly caused by the timezone environment variable.

### Limitation
This is NOT a flaky test in the traditional intermittent sense. A diagnosis system should correctly label this as an environmental failure, not a flaky one.

---

## Benchmark ID: FL-ORD-001
### Taxonomy Category
`Deterministic Order-Sensitive` (Manifests as intermittent in random-order suites)

### Mechanism
`test-order-dependency` (State Leakage)

### Hypothesis
A shared mutable array acts as a singleton and leaks state across tests if not run in the defined order.

### Baseline
When run under default Vitest order, the test passes 100% of the time.

### Perturbation
We change the execution order using `--sequence.shuffle --sequence.seed=<N>`.

### Observation
With `--sequence.seed=3` or `9`, the test fails 100% of the time. With `--sequence.seed=1` or `2`, the test passes 100% of the time.

### Interpretation
The failure is deterministically tied to execution order. In a real CI environment that shuffles tests without a fixed seed, this manifests as a flaky test.

### Limitation
The failure is not random; it is perfectly reproducible if the seed is known.

---

## Benchmark ID: FL-CONC-001
### Taxonomy Category
`Intermittent Concurrency-Sensitive`

### Mechanism
`resource-collision`

### Hypothesis
Two files attempt to write and read from the same `temp-resource.txt` file simultaneously, creating a race condition.

### Baseline
When executed normally (Vitest uses `--fileParallelism` by default), the test fails frequently (e.g., ~90% failure rate), but intermittently passes when OS timing aligns favorably.

### Perturbation
Constrain execution to a single thread using `--no-file-parallelism`.

### Observation
The tests pass 100% of the time when run serially.

### Interpretation
The failure is explicitly caused by parallel execution of multiple files interacting with a shared resource.

### Limitation
The test still requires multiple files to trigger; file parallelism in Vitest does not run individual test blocks in parallel within the same file.

---

## Benchmark ID: FL-INT-001
### Taxonomy Category
`Genuine Intermittent`

### Mechanism
`async-timing-race`

### Hypothesis
The test incorrectly "sleeps" for a fixed amount of time (`setTimeout`) to wait for a background task instead of awaiting the promise. 

### Baseline
When run under the exact same environment, command, and conditions, the test will sometimes pass and sometimes fail due to Node.js event loop scheduling jitter.

### Perturbation
None required to expose flakiness.

### Observation
Repeated executions of the exact same command produce a mix of PASS and FAIL results.

### Interpretation
This is a classic flaky test caused by bad asynchronous synchronization.

### Limitation
It does not respond predictably to order, concurrency, or timezone perturbations. A diagnosis system should recognize it as purely intermittent.
