# FlakeLedger Phase 7 API Documentation

## Base URL
`/api/v1`

## Error Format
All errors follow a structured format and use appropriate semantic HTTP status codes.
```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Missing config payload"
  }
}
```
**Common Error Codes:**
- `400 BAD_REQUEST`: Malformed request or validation failure.
- `404 EXPERIMENT_NOT_FOUND`: Experiment does not exist.
- `409 CONFLICT`: Experiment already exists or invalid state (e.g., already running, not running).
- `500 INTERNAL_ERROR`: Unexpected server failure.

---

## Lifecycle Endpoints

### 1. Health
`GET /health`
Returns the status of the API and its underlying storage.
**Response (200 OK):**
```json
{
  "status": "ok",
  "database": "reachable"
}
```

### 2. Create Experiment
`POST /experiments`
Creates a new experiment and stores its configuration.
**Body:** `ExperimentConfig` (must pass strict schema validation)
**Response (201 Created):**
```json
{
  "experimentId": "my-exp-1",
  "createdAt": "2026-10-06T10:00:00Z",
  "status": "created",
  "config": { ... }
}
```

### 3. List Experiments
`GET /experiments`
Lists all known experiments and their metadata.
**Response (200 OK):**
`Array<ExperimentMetadata>`

### 4. Get Experiment
`GET /experiments/:id`
Retrieves a specific experiment.
**Response (200 OK):**
`ExperimentMetadata`

---

## Execution Endpoints

### 5. Execute Experiment
`POST /experiments/:id/execute`
Starts the execution of an experiment asynchronously. The request returns immediately while the `ExecutionScheduler` runs in the background.

**Response (202 Accepted):**
```json
{ "status": "running" }
```
**Behaviors:**
- Resumes automatically if incomplete observations exist.
- Idempotent up to the missing conditions.
- Returns `409 CONFLICT` if already running.

### 6. Cancel Execution
`POST /experiments/:id/cancel`
Cancels an actively running experiment. The worker processes receive `SIGINT` (or `SIGKILL` if unresponsive), and the scheduler halts.

**Response (200 OK):**
```json
{ "status": "cancelled" }
```
**Behaviors:**
- Safely interrupts in-flight runs.
- Does NOT persist the interrupted attempt (preserving evidence cleanliness for resume).
- Returns `409 CONFLICT` if the experiment is not actively running.

---

## Evidence Endpoints

### 7. Get Observations
`GET /experiments/:id/observations`
Retrieves all collected evidence for the experiment.
**Response (200 OK):**
`Array<Observation>`
Includes all attempts per run (including preserved `process_failure` attempts).

### 8. Upload Observations (Manual/CLI sync)
`POST /experiments/:id/observations`
Allows manual injection of observations (e.g., from distributed runners if implemented in the future).
**Response (201 Created):**
```json
{ "status": "saved" }
```

---

## Diagnosis Endpoints

### 9. Trigger Diagnosis
`POST /experiments/:id/diagnose`
Runs the deterministic Diagnosis Engine over the existing evidence and saves the result.
**Response (201 Created):**
`DiagnosisResult`
**Behaviors:**
- Safely aggregates retries (the chronologically final attempt determines the logical run outcome).

### 10. Get Diagnosis
`GET /experiments/:id/diagnosis`
Retrieves the previously computed diagnosis.
**Response (200 OK):**
`DiagnosisResult`
