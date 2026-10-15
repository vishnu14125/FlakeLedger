# Phase 1 & 1.5 Results

## Environment
- **OS**: Windows 
- **Node version**: v20.14.0
- **Package manager**: npm (v10.7.0)
- **Vitest version**: v2.1.9 

## Benchmark inventory
1. **FL-TZ-001**: Timezone boundary parsing bug.
2. **FL-ORD-001**: Test order dependency via leaked singleton state.
3. **FL-CONC-001**: Concurrency collision on a shared file system resource.
4. **FL-INT-001**: Genuine intermittent async timing race condition.
5. **Stable Control**: Pure function tests that remain deterministic.

## Baseline & Perturbation Results

### FL-TZ-001 (Deterministic Environment-Sensitive)
- **Baseline (UTC)**: 100% Pass (1/1 runs)
- **Perturbation (America/New_York)**: 100% Fail. 
- *Note*: Not a flaky test. It is a deterministic failure dependent on the environment.

### FL-ORD-001 (Deterministic Order-Sensitive)
- **Baseline (Normal order)**: 100% Pass
- **Perturbation (Shuffle, multiple seeds)**:
  - Seed 1, 2, 4, 5, 6, 7, 8, 10: PASS
  - Seed 3, 9: FAIL
- *Note*: It is deterministic per-seed, but manifests as intermittent flakiness in environments that randomize test execution.

### FL-CONC-001 (Intermittent Concurrency-Sensitive)
- **Baseline (Parallel - default)**: ~95% Fail, ~5% Pass (Tested over 20 runs, passed on run 19).
- **Perturbation (Serial via `--no-file-parallelism`)**: 100% Pass.
- *Note*: This is a genuinely intermittent race condition heavily biased toward failure, which is perfectly cured by serializing execution.

### FL-INT-001 (Genuine Intermittent)
- **Baseline (Normal execution)**: ~50% Fail, ~50% Pass (Tested over 30 runs, produced mixed results like `Run 1 FAIL, Run 2 PASS`).
- *Note*: A true flaky test that fails unpredictably under the exact same conditions due to event loop jitter.

## Supported Vitest capabilities
- **Timezone control**: VERIFIED.
- **Test order control**: VERIFIED (`--sequence.shuffle`).
- **Concurrency control**: VERIFIED (`--no-file-parallelism`).
