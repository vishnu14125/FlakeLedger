# FlakeLedger Phase 7 Validation Report

## 1. Objective
Build a clean application/API layer around the existing FlakeLedger experiment engine. Expose existing experiment capabilities through a controlled service boundary while keeping the execution engine isolated from HTTP concerns, ensuring that the API orchestrates rather than duplicates logic.

## 2. Architecture Before Phase 7
- Express API provided simple CRUD operations to PostgreSQL.
- CLI directly instantiated `ExperimentPlanner`, `ExecutionScheduler`, and `ExecutionWorker`.
- No asynchronous remote execution capabilities; executions were fully blocking in the terminal.

## 3. Architecture After Phase 7
- **API Boundary**: Express routes handle basic parsing, manual schema validation (via custom validation function since Zod is absent), and HTTP error mapping.
- **Service Layer (`ExperimentService`)**: An Application Service boundary that wraps `ExecutionScheduler` and `ExperimentPlanner`. It maintains an in-memory registry of active schedulers (`activeSchedulers`).
- **CLI**: Rewritten to consume `ExperimentService`. It now loops and polls for completion, honoring the async-first boundary of the service layer.

## 4. API/Application Boundary
The API relies entirely on HTTP primitives. It delegates all business rules to `ExperimentService`, avoiding any Express `req`/`res` leakage.

## 5. Service Responsibilities
`ExperimentService` encapsulates:
- Experiment creation/retrieval
- Execution triggering (instantiating `ExecutionScheduler` asynchronously)
- Cancellation triggering
- Diagnosis computation
- Centralized error throwing mapped to HTTP semantics

## 6. Endpoint Inventory
- `GET /api/v1/health`
- `POST /api/v1/experiments`
- `GET /api/v1/experiments`
- `GET /api/v1/experiments/:id`
- `PUT /api/v1/experiments/:id`
- `POST /api/v1/experiments/:id/execute` (Async start)
- `POST /api/v1/experiments/:id/cancel` (Graceful abort)
- `POST /api/v1/experiments/:id/observations`
- `GET /api/v1/experiments/:id/observations`
- `POST /api/v1/experiments/:id/diagnose`
- `GET /api/v1/experiments/:id/diagnosis`

## 7. Validation Strategy
Since Zod is absent, a custom `validateExperimentConfig` type-guard rigorously verifies schema boundaries (string patterns, numeric bounds like `timeoutMs`, `runsPerCondition`) ensuring malformed configurations are rejected with a `400 BAD_REQUEST`.

## 8. Security Review
- **No Arbitrary Command Execution**: Target runs are strictly invoked via the existing `npx vitest run [target]` encapsulation in `worker.ts`.
- No direct SQL queries in the API logic.
- Path traversal prevented implicitly by the API not dealing with arbitrary paths outside the validated `target` and `projectPath` restrictions.

## 9. Concurrency Behavior
If an experiment is already executing (`this.activeSchedulers.has(id)`), `ExperimentService` immediately throws `EXPERIMENT_ALREADY_RUNNING`, mapped to `409 CONFLICT`. This safely prevents concurrent schedulers on the same condition set.

## 10. Execution Lifecycle
State machine transitions: `created` -> `running` -> `completed` / `failed` / `cancelled`.

## 11. Cancellation
`POST /cancel` triggers `Scheduler.cancel()`. It halts the retry loops and sends `SIGINT`/`SIGKILL` to active workers. The actively cancelled attempt is explicitly NOT saved, leaving only complete evidence for strict deterministic resume logic.

## 12. Retry Evidence Behavior
Remains completely intact from Phase 6.6. Intermediate failures (`PROCESS_FAILURE`) are accurately appended to Postgres/local files.

## 13. Diagnosis Behavior
API-triggered diagnosis (`POST /diagnose`) relies purely on the existing algorithm and natively aggregates retry evidence by logical run numbers.

## 14. Backward Compatibility
The architectural test guarantees that no Phase 6 execution logic was accidentally re-written or leaked. All integrations including `LocalFileExperimentRepository` and PGlite tests continue functioning seamlessly.

## 15. Test Results
- Full test suite execution: **59 tests passed** across **13 test files** (0 failed).
- All Architectural boundaries strictly verified.

## 16. Known Limitations
- The execution registry (`activeSchedulers`) is strictly in-memory. If the Node.js server dies, running child processes will orphan, and their states will remain "running" indefinitely until manually repaired or resumed upon a server restart.
- No authentication boundary implemented.

## 17. Architectural Decisions
- Removed `status: 'running'` default on creation in favor of `status: 'created'`, reserving `running` strictly for active scheduling via `POST /execute`.

## 18. Final Verdict
**PASS**
