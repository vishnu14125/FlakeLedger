import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { LocalFileExperimentRepository } from '../src/local-repository';
import { Observation, ExperimentConfig } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ExperimentRepository', () => {
  let tempDir: string;
  let repo: LocalFileExperimentRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flakeledger-test-'));
    repo = new LocalFileExperimentRepository(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const dummyConfig: ExperimentConfig = {
    experimentId: 'TEST-123',
    target: 'foo.test.ts',
    projectPath: '/',
    runsPerCondition: 1,
    conditionDefs: {},
    conditions: [],
    timeoutMs: 1000
  };

  test('Creates experiment directory and metadata', async () => {
    const meta = await repo.createExperiment(dummyConfig);
    expect(meta.experimentId).toBe('TEST-123');
    expect(meta.status).toBe('created');

    const readMeta = await repo.getMetadata('TEST-123');
    expect(readMeta).not.toBeNull();
    expect(readMeta?.status).toBe('created');
  });

  test('Saves and retrieves observations immutably', async () => {
    await repo.createExperiment(dummyConfig);

    const obs: Observation = {
      observationId: 'TEST-123-cond-1',
      experimentId: 'TEST-123',
      conditionId: 'cond',
      runNumber: 1,
      startedAt: new Date().toISOString(),
      durationMs: 100,
      processStatus: 'success',
      testResults: [],
      environment: { nodeVersion: '20', platform: 'win32', arch: 'x64', timezone: 'UTC', args: [] }
    };

    await repo.saveObservations('TEST-123', [obs]);
    const readObs = await repo.getObservations('TEST-123');

    expect(readObs).toHaveLength(1);
    expect(readObs[0].observationId).toBe('TEST-123-cond-1');
  });

  test('Deduplicates observations automatically', async () => {
    await repo.createExperiment(dummyConfig);

    const obs: Observation = {
      observationId: 'TEST-123-cond-1',
      experimentId: 'TEST-123',
      conditionId: 'cond',
      runNumber: 1,
      startedAt: new Date().toISOString(),
      durationMs: 100,
      processStatus: 'success',
      testResults: [],
      environment: { nodeVersion: '20', platform: 'win32', arch: 'x64', timezone: 'UTC', args: [] }
    };

    await repo.saveObservations('TEST-123', [obs]);
    await repo.saveObservations('TEST-123', [obs]);

    const readObs = await repo.getObservations('TEST-123');
    expect(readObs).toHaveLength(1);
  });

  test('Lists experiments sorted by createdAt', async () => {
    await repo.createExperiment({ ...dummyConfig, experimentId: 'EXP-1' });
    await new Promise(r => setTimeout(r, 10));
    await repo.createExperiment({ ...dummyConfig, experimentId: 'EXP-2' });

    const list = await repo.listExperiments();
    expect(list.items).toHaveLength(2);
    expect(list.items[0].experimentId).toBe('EXP-2');
    expect(list.items[1].experimentId).toBe('EXP-1');
  });

  test('Strips terminal evidence from getObservations and serves via getObservationTerminal', async () => {
    await repo.createExperiment(dummyConfig);
    const obs: Observation = {
      observationId: 'TEST-123-cond-1',
      experimentId: 'TEST-123',
      conditionId: 'cond',
      runNumber: 1,
      startedAt: new Date().toISOString(),
      durationMs: 100,
      processStatus: 'success',
      testResults: [],
      environment: { nodeVersion: '20', platform: 'win32', arch: 'x64', timezone: 'UTC', args: [] },
      stdout: 'some stdout',
      stderr: 'some stderr',
      exitCode: 42
    };

    await repo.saveObservations('TEST-123', [obs]);

    // Main payload is stripped
    const readObs = await repo.getObservations('TEST-123');
    expect(readObs[0].stdout).toBeUndefined();
    expect(readObs[0].stderr).toBeUndefined();
    expect(readObs[0].exitCode).toBe(42);

    // Terminal endpoint serves it
    const term = await repo.getObservationTerminal('TEST-123', 'TEST-123-cond-1');
    expect(term).not.toBeNull();
    expect(term?.stdout).toBe('some stdout');
    expect(term?.stderr).toBe('some stderr');
    expect(term?.exitCode).toBe(42);
  });

  test('Gracefully handles missing experiments', async () => {
    expect(await repo.getMetadata('DOES-NOT-EXIST')).toBeNull();
    expect(await repo.getObservations('DOES-NOT-EXIST')).toEqual([]);
    expect(await repo.getDiagnosis('DOES-NOT-EXIST')).toBeNull();
  });

  test('Migrates legacy flat files transparently', async () => {
    const expDir = path.join(tempDir, '.flakeledger', 'experiments');
    fs.mkdirSync(expDir, { recursive: true });

    const legacyRecord = {
      experimentId: 'LEGACY-1',
      config: dummyConfig,
      observations: [{ observationId: 'legacy-obs-1' }],
      summary: {}
    };
    fs.writeFileSync(path.join(expDir, 'LEGACY-1.json'), JSON.stringify(legacyRecord));

    const meta = await repo.getMetadata('LEGACY-1');
    expect(meta).not.toBeNull();

    const obs = await repo.getObservations('LEGACY-1');
    expect(obs).toHaveLength(1);
    expect(obs[0].observationId).toBe('legacy-obs-1');

    expect(fs.existsSync(path.join(expDir, 'LEGACY-1.json'))).toBe(false);
    expect(fs.existsSync(path.join(expDir, 'LEGACY-1', 'experiment.json'))).toBe(true);
  });
});
