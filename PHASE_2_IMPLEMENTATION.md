# Phase 2 Implementation

## 1. Architecture
We implemented a clean, decoupled Node.js CLI tool under `flakeledger-cli/`. It does not contain any diagnosis logic or AI. It exists solely to orchestrate test runners under strict environmental conditions and collect normalized evidence.

The architecture comprises:
- `cli.ts / index.ts`: Argument parsing and lifecycle triggering.
- `orchestrator.ts`: Manages the experiment loop (Conditions x Runs), creating the `ExperimentRecord`.
- `conditions.ts`: Defines generic perturbations (e.g., modifying `TZ` for environment sensitivity, using `--sequence.shuffle` for order, and `--no-file-parallelism` for concurrency).
- `runner.ts`: Handles secure child-process spawning of `vitest`. Deals with arbitrary timeouts, stdout/stderr, and prevents zombie processes. Outputs raw JSON to a unique temporary file.
- `parser.ts`: Normalizes Vitest's machine-readable JSON into FlakeLedger's standard `TestResult` schema, and applies SHA-256 fingerprinting to error messages for cross-run grouping.
- `store.ts`: Persists the complete `ExperimentRecord` to disk under `.flakeledger/experiments/*.json`.

## 2. CLI Commands
The CLI can be invoked natively using Node:
```bash
node dist/index.js investigate <target> [--runs <num>] [--timeout <ms>] [--conditions <c1,c2>] [--projectPath <path>]
```
**Examples used in dogfooding:**
```bash
node dist/index.js investigate test/order.test.ts --projectPath ../flakeledger-benchmarks --runs 5 --conditions baseline,order
node dist/index.js investigate "test/concurrency-a.test.ts test/concurrency-b.test.ts" --projectPath ../flakeledger-benchmarks --runs 10 --conditions baseline,concurrency
```

## 3. Experiment & Observation Model
Each experiment produces a robust JSON document that follows this conceptual schema:
```json
{
  "experimentId": "EXP-1791263292266",
  "config": {
    "target": "test/timezone.test.ts",
    "runsPerCondition": 3,
    "conditions": ["baseline", "timezone"]
  },
  "observations": [
    {
      "observationId": "OBS-1791263310344-1",
      "conditionId": "baseline",
      "runNumber": 1,
      "processStatus": "test_failure",
      "durationMs": 5211,
      "environment": {
        "nodeVersion": "v20.14.0",
        "timezone": "Asia/Calcutta",
        ...
      },
      "testResults": [
        {
          "testFile": "test/timezone.test.ts",
          "testName": "should be parsed as start of day",
          "status": "failed",
          "errorHash": "33a96e25"
        }
      ]
    }
  ],
  "summary": { ... }
}
```

## 4. Execution Lifecycle & Error Handling
1. **Spawn**: The engine spawns `npx vitest run ... --reporter=json --outputFile=<tmp>` in the target `projectPath`.
2. **Timeout**: If the execution exceeds `timeoutMs`, the engine kills the child process via `SIGKILL` and marks `processStatus: 'timeout'`.
3. **Parse**: If the process exits cleanly (even if tests failed), the engine reads the generated JSON.
4. **Resilience**: If the JSON is missing or malformed (e.g., Vitest crashed natively), the engine gracefully falls back to `processStatus: 'process_failure'`.

## 5. Result Normalization
All failures are stripped of line numbers and absolute filesystem paths before generating an `errorHash`. This ensures that stack trace variations due to local developer environments do not break future error grouping logic.

## 6. Benchmark Validation (Dogfooding)
We ran the CLI against the existing `flakeledger-benchmarks`.
- **FL-TZ-001**: Successfully ran both Baseline and Timezone conditions. As expected, Baseline failed because the engine inherits the host OS timezone (`Asia/Calcutta`), proving the environment capture is working correctly.
- **FL-ORD-001**: Baseline passed 100%. The `order` perturbation failed precisely when the hardcoded `--sequence.seed=3` condition was applied by the engine.
- **FL-CONC-001**: Caught the intermittent concurrency flake (mix of Passes/Fails under Baseline parallel mode), and successfully forced it to PASS 100% using the `concurrency` (serial) condition.
- **FL-INT-001**: Baseline execution cleanly caught the 50/50 intermittent passes/failures, successfully storing the varied outcomes under identical environment hashes.

## 7. Known Limitations
- The error normalizer uses a simple Regex to strip paths. A more robust sourcemap-aware stack trace normalizer will be required in Phase 3 or 4.
- `--sequence.seed` is currently hardcoded in the `order` condition. In the future, the engine should dynamically sweep seeds.

## 8. Future Phase 3 Requirements
Phase 3 should implement the **Diagnosis Engine**. It will read the `.flakeledger/experiments/*.json` evidence, aggregate the `errorHash` groupings, compare the pass/fail rates across the `conditionId` boundaries, and output a confidence-scored classification (e.g., "Highly confident this is an order-dependent flake"). No more execution mechanics should be built in Phase 3.
