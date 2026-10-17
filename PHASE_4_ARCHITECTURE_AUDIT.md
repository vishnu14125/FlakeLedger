# Phase 4 Architecture Audit

## Current Architecture
- **Creation**: Experiments are orchestrated in `src/orchestrator.ts`. It builds a single monolithic `ExperimentRecord` object containing the `config`, an array of `observations`, and a computed `summary`.
- **Representation**: An `Observation` represents a single process run, containing status, environment metadata, and parsed test results.
- **Persistence**: `src/store.ts` exports a single `saveExperiment` function that writes the entire `ExperimentRecord` to a flat file `.flakeledger/experiments/<experiment-id>.json`.
- **Diagnosis**: `src/index.ts` manually reads the flat file, passes the record to `analyzeExperiment()`, and then manually writes the output to `.flakeledger/experiments/<experiment-id>-diagnosis.json`. Diagnosis is safely derived and does not mutate the observations, but the persistence mechanism is scattered and coupled to the CLI layer.

## Problems Identified
1. **Monolithic Storage**: Raw evidence, experiment configuration, and summaries are entangled in one giant JSON object.
2. **Coupled Persistence**: The CLI (`index.ts`) is handling file I/O for diagnosis explicitly.
3. **No Atomicity**: `fs.writeFileSync` is used directly. If the CLI crashes mid-write, the JSON will be corrupted.
4. **No History API**: There is no API or CLI command to list historical experiments or inspect them without raw `cat`.
5. **No Idempotency/Deduplication**: Observations are batched into an array and persisted all at once. There's no way to append individual observations reliably if we wanted to resume an experiment.

## Proposed Phase 4 Architecture
Introduce an `ExperimentRepository` class/interface in `src/store.ts` (or `src/repository.ts`) with methods:
- `createExperiment(config)`
- `saveObservation(experimentId, observation)` (or batch `saveObservations`)
- `getExperiment(experimentId)`
- `listExperiments()`
- `saveDiagnosis(experimentId, diagnosis)`
- `getDiagnosis(experimentId)`

### Storage Layout
Move from flat files to a directory-per-experiment model:
```text
.flakeledger/
    experiments/
        <experiment-id>/
            experiment.json (metadata & config)
            observations.json (immutable array of raw evidence)
            diagnosis.json (derived result)
```

### Data Ownership Boundaries
- **Orchestrator**: Executes Vitest and creates `Observation` objects. Passes them to the Repository.
- **Repository**: Sole owner of `.flakeledger/` file I/O. Ensures atomic writes via temporary files + rename.
- **Diagnosis Engine**: Consumes `Experiment` + `Observation[]` (read-only) and returns `DiagnosisResult`.
- **CLI**: Wires these components together and formats the output.

### Backward Compatibility Considerations
Legacy experiments from Phase 2.5/3 are stored as `.flakeledger/experiments/EXP-XXX.json` and `EXP-XXX-diagnosis.json`.
The `ExperimentRepository` will detect legacy flat files. When requested, it will read them and gracefully migrate them into the new directory structure:
1. Create `EXP-XXX/`
2. Extract `config` -> `experiment.json`
3. Extract `observations` -> `observations.json`
4. Move `EXP-XXX-diagnosis.json` -> `EXP-XXX/diagnosis.json`
5. Delete legacy flat files.
This ensures no raw evidence is lost.

### Risks
- **Data Safety**: We must continue to ensure `process.env` is excluded. We will write an explicit test injecting a fake API key to ensure it isn't persisted.
- **Write Atomicity**: Using `temp` + `renameSync` works well on Unix but can sometimes throw `EPERM` on Windows if a file is locked. We will use a robust rename or fallback approach.
