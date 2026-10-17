# Phase 4: Persistence & Experiment History Validation

## 1. Architecture
The persistence model was fundamentally redesigned to decouple raw observation collection from the derived diagnosis result. The new architecture is built around an explicit `ExperimentRepository`:

```text
CLI
 │
 ├── Orchestrator (runs Vitest, streams Observations)
 │      │
 │      ▼
 │   ExperimentRepository (handles .flakeledger/ file I/O safely)
 │      │
 │      ▼
 │   [ experiment.json | observations.json ]
 │
 └── Diagnosis Engine (reads pure, immutable observations)
        │
        ▼
     ExperimentRepository (saves derived result)
        │
        ▼
     [ diagnosis.json ]
```

## 2. Data Model
- **ExperimentMetadata**: Contains execution intent (`config`), high-level execution `status`, and timestamps. Stored in `experiment.json`.
- **Observation**: Represents a single immutable execution. Stored incrementally in an array within `observations.json`. Identity is deterministic (`experimentId-conditionId-runNumber`).
- **Diagnosis**: Purely derived result artifact generated strictly from the contents of `observations.json`. Stored in `diagnosis.json`.

## 3. Immutability
Raw evidence (`observations.json`) is protected. The `Diagnosis Engine` treats the observation array as read-only. It processes them mathematically without ever modifying them or saving derived logic back into the raw array. 

## 4. Reproducibility
Since `observations.json` is immutable, running `flakeledger diagnose <experiment-id>` repeatedly will always predictably output identical results based on the deterministic Phase 3 math model. The diagnostic conclusion is completely detached from the time of execution.

## 5. Idempotency & Deduplication
The `ExperimentRepository` enforces deduplication. `saveObservations()` uses a `Set` to check `observationId`s before appending to the JSON file. If an orchestrator retry accidentally attempts to persist the same `OBS-1` twice, it is silently ignored, preventing accidental statistical skew.

## 6. Data Safety
The system explicitly strips and isolates execution environments. `process.env` is never dumped into `observations.json`. The engine explicitly picks only `nodeVersion`, `platform`, `arch`, `timezone`, and `args`. A dedicated `test/safety.test.ts` injects a fake `FLAKELEDGER_FAKE_SECRET` and asserts it is structurally impossible for it to bleed into the persistence layer.

## 7. Failure Handling
- **Missing Files**: Safely caught by the Repository layer (`getMetadata` returns `null`). The CLI reports "Experiment not found".
- **Corrupt Files**: Managed using `atomicWrite` (temporary `.tmp` files with `fs.renameSync`). This guarantees partial writes due to CLI crashes do not corrupt existing experiment histories.
- **Legacy Migrations**: Phase 2 flat files (`EXP-123.json`) are automatically detected and non-destructively migrated into the directory structure when the CLI touches them (e.g., via `history`).

## 8. CLI Additions
- `flakeledger history`: Lists all tracked experiments across time.
- `flakeledger show <id>`: Displays comprehensive configuration metadata and current diagnosis status without re-triggering execution.

## 9. Tests
- **Tests Added**: 6 store tests, 1 safety test.
- **Total Tests**: 29 tests across all domains.
- **Passing**: 29
- **Failing**: 0

## 10. Benchmark Validation
The real benchmark suite continued to report identical diagnosis classifications after the persistence migration:
- **Timezone**: `ENVIRONMENT_SENSITIVE`
- **Order**: `ORDER_SENSITIVE`
- **Concurrency**: `CONCURRENCY_SENSITIVE`
- **Intermittent**: `INTERMITTENT`
- **Stable**: `STABLE`

## 11. Limitations
The storage backend relies on local file I/O operations. While `renameSync` ensures near-atomic file replacement on UNIX, Windows environments occasionally suffer from transient file locks by antivirus software, which might cause `renameSync` to temporarily throw `EPERM` during highly concurrent operations. Since the CLI is a single-threaded local dev tool, this risk is minimal but present.

## Phase 4 Readiness
**READY FOR PHASE 5**
