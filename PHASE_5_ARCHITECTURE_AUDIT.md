# Phase 5 Architecture Audit

## Current Architecture (Phase 4)
Currently, the system is a local CLI tool:
- `CLI (index.ts)` parses commands and configurations.
- `Orchestrator (orchestrator.ts)` executes tests locally via `Vitest`.
- `ExperimentRepository (store.ts)` directly writes JSON to the `.flakeledger/experiments/` local directory.
- `Diagnosis Engine (diagnosis.ts)` mathematically derives diagnoses from pure, immutable observation arrays.
- There is no network component, no database, and the CLI directly manipulates the local filesystem repository.

## Target Architecture (Phase 5)
```text
Developer CLI
 │
 ▼
HTTP API (Fastify or Express)
 │
 ▼
Application Layer (ExperimentService)
 │
 ├─────────────────────────────────┐
 ▼                                 ▼
Execution (CLI/Local)          Repository Interface
 │                                 │
 ▼                                 ▼
Evidence (Observations)        PostgreSQL Database
 │
 ▼
Diagnosis Engine (Pure Domain)
```

### Key Boundaries
1. **Execution**: Remains purely local on the developer's machine via the CLI. The backend will *not* execute user code.
2. **Application Orchestration**: The API exposes HTTP endpoints to receive observations, trigger diagnoses, and query history.
3. **Diagnosis**: Remains a pure function `(config, observations[]) => DiagnosisResult`. It will not query SQL.
4. **Persistence**: The `ExperimentRepository` interface will have two implementations:
   - `LocalFileExperimentRepository` (Phase 4 legacy/fallback)
   - `PostgresExperimentRepository` (Phase 5 default for API)
5. **HTTP Transport**: REST endpoints strictly handle routing and JSON mapping. They delegate to an `ExperimentService`.

## Database Approach
- **Database driver:** `pg`
- **ORM:** None
- **Query style:** Parameterized SQL
- **Schema initialization:** `CREATE TABLE IF NOT EXISTS`
- **Versioned migration framework:** Not yet implemented

I will use **raw `pg`** (via parameterized SQL queries with `$1`, `$2`, etc.). Since the domain model is highly structured and already well-defined, introducing an ORM like Drizzle or Prisma adds unnecessary bloat and abstraction overhead for a schema consisting of just three very simple tables. Raw `pg` perfectly fits the mandate for "type safety, simplicity, migrations, testability, explainability, low abstraction overhead" without dragging in heavy generation tools. 
*Note: We will use `@electric-sql/pglite` dynamically in testing to prove real WASM Postgres query validity natively without CI Docker setups.*

## Storage Decisions (Relational vs JSONB)
- **experiments**:
  - `id` (text, pk)
  - `target` (text)
  - `status` (text)
  - `config` (jsonb) -> The exact Vitest/condition config is highly nested and rarely queried independently.
  - `summary` (jsonb) -> High-level stats.
  - `created_at` (timestamp)
- **observations**:
  - `id` (text, pk) -> Formatted as `expId-conditionId-runNumber` to enforce idempotency natively.
  - `experiment_id` (text, fk -> experiments.id)
  - `condition_id` (text)
  - `run_number` (int)
  - `process_status` (text)
  - `duration_ms` (int)
  - `test_results` (jsonb) -> Contains raw stack traces and individual assertion arrays. Best as JSONB.
  - `environment` (jsonb)
- **diagnoses**:
  - `experiment_id` (text, pk, fk -> experiments.id)
  - `classification` (text)
  - `confidence` (text)
  - `explanation` (jsonb array)
  - `evidence` (jsonb) -> Condition metrics are complex arrays.

## Migration Path
- Phase 4 data resides in `.flakeledger/experiments/`.
- I will build a CLI command `flakeledger migrate-local-to-pg` which loops over `LocalFileExperimentRepository` and blindly `POST`s them to the API (or directly inserts them) without deleting the local JSON files.

## Risks & Safety
- **process.env**: Will continue to be scrubbed before hitting the API.
- **Transactions**: Creating an experiment and its initial metadata will be transactional.
- **SQL Injection**: Prevented inherently by Drizzle ORM / parameterized queries.
