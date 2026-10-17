# Phase 6 Architecture Audit

## Current Architecture
The current orchestrator (`src/orchestrator.ts`) is a monolithic loop. It:
1. Receives an `ExperimentConfig` containing `runsPerCondition` and a `conditions` array.
2. Iterates over conditions sequentially.
3. For each condition, iterates `1..runsPerCondition` sequentially.
4. Spawns `Vitest` using `runVitest()`.
5. Waits for completion, parses stdout JSON (`parseVitestOutput`), formats an `Observation`.
6. Saves the observation via `IExperimentRepository.saveObservations` one by one.
7. Has no concept of concurrency, retries, timeouts, explicit cancellation (Ctrl+C leaves orphans), or machine-readable progress.

## Weaknesses
- **Monolithic Loop**: No separation between planning (what to run) and execution (how to run).
- **No Concurrency**: Tests are executed strictly sequentially. Running 10 conditions × 10 runs takes 100x the duration of one test.
- **Hanging Processes**: If Vitest hangs (e.g. infinite loop), the orchestrator blocks forever.
- **Orphaned Processes**: Ctrl+C kills the CLI but leaves active Vitest child processes running.
- **No Retries for Infra Failures**: If Vitest crashes due to a memory error, it counts as a generic `PROCESS_FAILURE` without any attempt to recover the run.
- **No Incremental Resume**: Technically, the repository avoids deduplication, but the orchestrator loop blindly tries to execute *everything* every time instead of checking what is already completed.

## Target Phase 6 Architecture
We will decouple orchestration into discrete components inside `src/orchestrator/`:

1. **`Planner`**: Accepts an `ExperimentConfig`, queries the `Repository` for existing observations, and generates an array of discrete `ExecutionTask` objects that still need to run.
2. **`Worker`**: A pure function/class that takes a single `ExecutionTask`, spawns Vitest with a strict `timeout`, handles cancellation signals, catches process crashes, and returns a raw `ExecutionResult`.
3. **`Scheduler`**: Accepts the `ExecutionTask` queue and manages a `concurrency` limit (e.g. via `p-limit` or a custom async worker pool). It dispatches tasks to the `Worker`, applies retry policies for infra failures, and funnels results to the Collector.
4. **`Collector`**: Receives `ExecutionResult`s incrementally from the Scheduler, normalizes them into immutable `Observation` records, and pushes them instantly to the `Repository`.

### Data Model Enhancements
- `ExperimentConfig` will gain:
  - `concurrency?: number`
  - `timeoutMs?: number`
  - `failFast?: boolean`
  - `retryPolicy?: { maxRetries: number }`
- `ProcessStatus` will be expanded: `SUCCESS`, `TEST_FAILURE`, `PROCESS_FAILURE`, `TIMEOUT`, `CANCELLED`.
