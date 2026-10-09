import { expect, test, describe, beforeAll, afterAll } from 'vitest';
import { PostgresExperimentRepository } from '../src/postgres-repository';
import { PGlite } from '@electric-sql/pglite';
import { Observation } from '../src/types';

describe('PostgreSQL Constraints & Concurrency Verification', () => {
  let db: any;
  let repo: PostgresExperimentRepository;

  beforeAll(async () => {
    db = new PGlite();
    repo = new PostgresExperimentRepository(db as any);
    await repo.initializeSchema();
    
    // Seed an experiment
    await repo.createExperiment({
      experimentId: 'CONST-EXP-1',
      target: 'const.test.ts',
      projectPath: '/',
      runsPerCondition: 1,
      conditionDefs: {},
      conditions: [],
      timeoutMs: 1000
    });
  });

  afterAll(async () => {
    await repo.close();
  });

  test('Constraint: Duplicate observation is safely ignored (Idempotency)', async () => {
    const obs: Observation = {
      observationId: 'CONST-EXP-1-base-1',
      experimentId: 'CONST-EXP-1',
      conditionId: 'base',
      runNumber: 1,
      startedAt: new Date().toISOString(),
      durationMs: 50,
      processStatus: 'success',
      testResults: [],
      environment: { nodeVersion: '20', platform: 'linux', arch: 'x64', timezone: 'UTC', args: [] }
    };

    // First insert
    await repo.saveObservations('CONST-EXP-1', [obs]);
    
    // Duplicate insert
    await repo.saveObservations('CONST-EXP-1', [obs]);

    const result = await db.query("SELECT COUNT(*) as count FROM observations WHERE id = 'CONST-EXP-1-base-1'");
    // Thanks to ON CONFLICT DO NOTHING, count is exactly 1.
    expect(Number(result.rows[0].count)).toBe(1);
  });

  test('Constraint: Foreign key violation rejects observation', async () => {
    const badObs: Observation = {
      observationId: 'MISSING-EXP-base-1',
      experimentId: 'MISSING-EXP', // DOES NOT EXIST
      conditionId: 'base',
      runNumber: 1,
      startedAt: new Date().toISOString(),
      durationMs: 50,
      processStatus: 'success',
      testResults: [],
      environment: { nodeVersion: '20', platform: 'linux', arch: 'x64', timezone: 'UTC', args: [] }
    };

    // The database must natively reject this due to foreign key constraints,
    // intercepting the query execution.
    await expect(repo.saveObservations('MISSING-EXP', [badObs])).rejects.toThrow(/foreign key constraint/i);
  });

  test('Constraint: Concurrent duplicate insertion avoids race conditions', async () => {
    const obs2: Observation = {
      observationId: 'CONST-EXP-1-base-2',
      experimentId: 'CONST-EXP-1',
      conditionId: 'base',
      runNumber: 2,
      startedAt: new Date().toISOString(),
      durationMs: 50,
      processStatus: 'success',
      testResults: [],
      environment: { nodeVersion: '20', platform: 'linux', arch: 'x64', timezone: 'UTC', args: [] }
    };

    // Fire exactly the same observation simultaneously (simulating two API requests overlapping)
    const reqA = repo.saveObservations('CONST-EXP-1', [obs2]);
    const reqB = repo.saveObservations('CONST-EXP-1', [obs2]);

    await Promise.all([reqA, reqB]);

    const result = await db.query("SELECT COUNT(*) as count FROM observations WHERE id = 'CONST-EXP-1-base-2'");
    // Database unique index + ON CONFLICT guarantees exact atomicity.
    expect(Number(result.rows[0].count)).toBe(1);
  });
});
