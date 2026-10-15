import { expect, test, describe, beforeAll, afterAll } from 'vitest';
import { LocalFileExperimentRepository } from '../src/local-repository';
import { PostgresExperimentRepository } from '../src/postgres-repository';
import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Phase 4 -> Postgres Migration Verification', () => {
  let tempDir: string;
  let localRepo: LocalFileExperimentRepository;
  let pgRepo: PostgresExperimentRepository;
  let db: any;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flakeledger-migration-'));
    localRepo = new LocalFileExperimentRepository(tempDir);
    
    db = new PGlite();
    pgRepo = new PostgresExperimentRepository(db as any);
    await pgRepo.initializeSchema();

    // Setup Phase 4 Data Fixture
    const config = {
      experimentId: 'MIGRATE-EXP',
      target: 'bench.test.ts',
      projectPath: '/',
      runsPerCondition: 2,
      conditionDefs: {},
      conditions: [],
      timeoutMs: 1000
    };

    await localRepo.createExperiment(config);
    await localRepo.updateMetadata('MIGRATE-EXP', { status: 'completed' });
    
    const obs = [
      {
        observationId: 'MIGRATE-EXP-c1-1',
        experimentId: 'MIGRATE-EXP',
        conditionId: 'c1',
        runNumber: 1,
        startedAt: new Date().toISOString(),
        durationMs: 100,
        processStatus: 'success',
        testResults: [{ name: 't1', status: 'passed' }],
        environment: { nodeVersion: '20', platform: 'linux', arch: 'x64', timezone: 'UTC', args: [] }
      } as any,
      {
        observationId: 'MIGRATE-EXP-c1-2',
        experimentId: 'MIGRATE-EXP',
        conditionId: 'c1',
        runNumber: 2,
        startedAt: new Date().toISOString(),
        durationMs: 105,
        processStatus: 'test_failure',
        testResults: [{ name: 't1', status: 'failed', errorHash: 'E123' }],
        environment: { nodeVersion: '20', platform: 'linux', arch: 'x64', timezone: 'UTC', args: [] }
      } as any
    ];
    await localRepo.saveObservations('MIGRATE-EXP', obs);

    await localRepo.saveDiagnosis('MIGRATE-EXP', {
      classification: 'INTERMITTENT',
      confidence: 'HIGH',
      limitations: '',
      evidence: { explanation: ['Explanation text'], conditionMetrics: {}, totalObservations: 2 }
    } as any);

    // SIMULATE THE CLI `flakeledger migrate` PROCESS
    const expsResult = await localRepo.listExperiments();
    const exps = expsResult.items;
    for (const exp of exps) {
      await pgRepo.createExperiment(exp.config);
      const obs = await localRepo.getObservations(exp.experimentId);
      await pgRepo.saveObservations(exp.experimentId, obs);
      const diag = await localRepo.getDiagnosis(exp.experimentId);
      if (diag) await pgRepo.saveDiagnosis(exp.experimentId, diag);
      await pgRepo.updateMetadata(exp.experimentId, { status: exp.status, summary: exp.summary });
    }
  });

  afterAll(async () => {
    await pgRepo.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('Metadata integrity counts are preserved', async () => {
    const localExps = (await localRepo.listExperiments()).items;
    const pgExps = (await pgRepo.listExperiments()).items;
    
    expect(localExps.length).toBe(1);
    expect(pgExps.length).toBe(1);
    expect(pgExps[0].experimentId).toBe('MIGRATE-EXP');
    expect(pgExps[0].status).toBe('completed');
  });

  test('Observation integrity and counts are preserved', async () => {
    const localObs = await localRepo.getObservations('MIGRATE-EXP');
    const pgObs = await pgRepo.getObservations('MIGRATE-EXP');
    
    expect(pgObs.length).toBe(localObs.length);
    expect(pgObs.length).toBe(2);

    // Semantic property checks
    expect(pgObs[1].observationId).toBe('MIGRATE-EXP-c1-2');
    expect(pgObs[1].processStatus).toBe('test_failure');
    expect(pgObs[1].testResults[0].errorHash).toBe('E123');
    expect(pgObs[1].environment.platform).toBe('linux');
  });

  test('Diagnosis classification semantics are identical', async () => {
    const localDiag = await localRepo.getDiagnosis('MIGRATE-EXP');
    const pgDiag = await pgRepo.getDiagnosis('MIGRATE-EXP');

    expect(pgDiag).not.toBeNull();
    expect(pgDiag!.classification).toBe('INTERMITTENT');
    expect(pgDiag!.confidence).toBe('HIGH');
    expect(pgDiag!.evidence.totalObservations).toBe(2);
    expect(pgDiag!.evidence.explanation[0]).toBe('Explanation text');
  });
});
