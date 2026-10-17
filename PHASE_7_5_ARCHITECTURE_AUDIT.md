# Phase 7.5 Architecture Audit

## 1. Boundary Verifications
- **API Boundary (`api.ts`)**: Confirmed thin. Maps HTTP primitives natively. No domain logic present. Validates schemas and routes into `ExperimentService`.
- **Service Boundary (`service.ts`)**: True domain orchestrator. Orchestrates `ExperimentPlanner` and `ExecutionScheduler`. Correctly maintains `activeSchedulers` registry. 
- **Execution Boundary (`worker.ts`)**: Confirmed no duplication of child process logic. API HTTP handlers NEVER call `spawn` directly. All processes run isolated inside the established `npx vitest run` Vitest boundary.
- **Repository Boundary (`postgres-repository.ts` / `local-repository.ts`)**: Used faithfully by the service. Local file operations are preserved seamlessly.

## 2. Active Scheduler Registry
`activeSchedulers` is a `Map<string, ExecutionScheduler>`.
- **Finding**: A race condition existed where concurrent executions could duplicate the scheduler if they fired before the `repo.getMetadata` Promise resolved.
- **Resolution**: Fixed in Phase 7.5 by synchronously mapping a `{}` placeholder before `await` resolution, effectively enforcing a strict synchronous lock on the ID. `cancelExperiment` was updated to safely typecheck `typeof scheduler.cancel === 'function'` to avoid crashing on the placeholder.
- **Lifecycle**: Re-verified that the scheduler is safely purged from the registry using a `.then().catch()` block after `scheduler.run()` fulfills or rejects.

## 3. Observation Persistence Path
- `POST /api/v1/experiments/:id/observations` accepts arrays of observations. 
- It exists to allow for manual or CLI-driven evidence injection.
- While it can theoretically inject false observations, this is considered *intended behavior* given the lack of an Authentication layer (out of scope for Phase 7/7.5). The API assumes the internal network is trusted.

## 4. Cancellation Path
- Confirmed `POST /cancel` delegates directly to Phase 6.6 `ExecutionScheduler.cancel()`, which sends `SIGINT/SIGKILL` to active workers. 
- Graceful termination terminology is corrected in docs: process termination is forced via standard OS signals, not "graceful" cleanups by Vitest itself.

## 5. Potential State Discrepancies
- The system supports transitions: `created -> running -> completed | failed | cancelled`.
- Resuming an experiment correctly maps it back from `cancelled/completed` to `running`.
- Restarting the Node server safely drops the memory `activeSchedulers`, leaving experiments technically marked as `running` in the DB. The service allows `execute` on them by checking the runtime map, effectively overriding stale database statuses.
