# Phase 7 Architecture Audit

## 1. Current Architecture Overview
The system currently consists of:
- **CLI/Orchestrator Boundary (`src/orchestrator/index.ts`)**: Directly instantiates the Repository, creates metadata, queries existing observations, and runs `ExperimentPlanner` and `ExecutionScheduler`. It has no knowledge of HTTP APIs.
- **API Boundary (`src/api.ts`)**: Defines basic Express endpoints for REST-style CRUD operations (`GET /experiments`, `POST /experiments`, etc.). Currently delegates all business logic to `ExperimentService`.
- **Service Layer Boundary (`src/service.ts`)**: A thin wrapper over the repository. It performs simple operations like `createExperiment`, `runDiagnosis`, but currently has NO orchestration capabilities (it does not start/resume experiments via `ExecutionScheduler`).
- **Execution Engine Boundary (`src/orchestrator/planner.ts, worker.ts, scheduler.ts`)**: Responsible for execution state, retry/failfast semantics, and observation persistence. It operates synchronously over an active instance.
- **Repository Boundary (`src/postgres-repository.ts`, `src/local-repository.ts`)**: Exposes `IExperimentRepository` to abstract Postgres/Local file storage.

## 2. Existing Duplication & Coupling
- **Coupling**: The CLI directly drives the execution engine (Planner -> Scheduler -> Worker) and couples execution with the terminal (console logging progress).
- **Missing API capabilities**: The API currently allows uploading observations (`POST /observations`), but it DOES NOT allow triggering the actual orchestration engine. `ExecutionScheduler` is completely inaccessible via the API.
- **Absence of Centralized Cancellation**: `ExecutionScheduler.cancel()` exists, but there is no way to cancel an actively running experiment via the API, nor is there a registry of actively running schedulers to map an HTTP request to the active `ExecutionScheduler` instance.

## 3. What Will Be Changed (Phase 7 Scope)
- **Service Layer Expansion**: `ExperimentService` will be updated to orchestrate execution natively. The CLI will be updated to consume `ExperimentService` rather than directly driving the `ExecutionScheduler`.
- **In-Memory Registry**: To support asynchronous execution and cancellation, `ExperimentService` will maintain a private `Map<string, ExecutionScheduler>` registry.
- **Execution Endpoints**: We will expose `POST /api/v1/experiments/:id/execute` to trigger the execution engine, and `POST /api/v1/experiments/:id/cancel` to invoke `.cancel()` on the active scheduler.
- **Validation Constraints**: Manual validation routines will be added to enforce proper schemas at the HTTP boundary, since Zod or similar libraries are not present in the stack.
- **Error Model**: We will map internal domain errors to strict HTTP semantic responses (400, 404, 409, 422, 500) directly in the route handlers.

## 4. What Will Remain Unchanged
- The internal Phase 6 Execution Engine (`ExperimentPlanner`, `ExecutionScheduler`, `ExecutionWorker`) will NOT be modified. They already handle deterministic retry semantics, concurrency bounds, timeouts, and process failures.
- The Phase 3 `Diagnosis Engine` will remain fully untouched.
- The Repository implementations (`PostgresExperimentRepository`, `LocalFileExperimentRepository`) will remain the same.
- We will NOT introduce distributed execution (e.g., Redis, RabbitMQ) or new persistence structures. Execution remains strictly in-process via local `child_process.spawn`.
