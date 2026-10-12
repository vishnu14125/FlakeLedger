import { expect, test, describe, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApi } from '../src/api';
import { ExperimentService } from '../src/service';
import { PostgresExperimentRepository } from '../src/postgres-repository';
import { ExperimentConfig, Observation } from '../src/types';

import { PGlite } from '@electric-sql/pglite';

// We must use a separate test database to avoid dropping production!
const testDbUrl = process.env.FLAKELEDGER_TEST_DATABASE_URL;
const API_KEY = 'test-api-key-0123456789abcdef';

// Every route except /health requires the bearer token.
let app: any;
const authed = (method: 'get' | 'post' | 'put') => (url: string) =>
  (request(app) as any)[method](url).set('Authorization', `Bearer ${API_KEY}`);
const api = { get: authed('get'), post: authed('post'), put: authed('put') };

describe('API & Postgres Integration', () => {
  test('F4.2 GET /api/v1/experiments normalizes invalid page inputs', async () => {
    const invalidPages = ['abc', '0', '-1', '-100'];
    for (const p of invalidPages) {
      const res = await api.get('/api/v1/experiments?page=' + p);
      expect(res.status).toBe(200);
      expect(res.body.page).toBe(1); // Normalized to 1
    }
  });
  let repo: PostgresExperimentRepository;
  let service: ExperimentService;

  beforeAll(async () => {
    let client;
    if (testDbUrl) {
      repo = new PostgresExperimentRepository(testDbUrl);
      try {
        await repo.initializeSchema();
        const pool = (repo as any).client;
        await pool.query('TRUNCATE experiments CASCADE');
      } catch (e: any) {
        if (e.code === 'ECONNREFUSED' || e.message.includes('password')) {
          console.warn('Skipping Postgres tests: Test DB not reachable.');
          return;
        }
        throw e;
      }
    } else {
      client = new PGlite();
      repo = new PostgresExperimentRepository(client as any);
      await repo.initializeSchema();
    }

    service = new ExperimentService(repo);
    app = createApi(service, { apiKey: API_KEY });
  });

  afterAll(async () => {
    if (repo) await repo.close();
  });

  test('GET /api/v1/health', async () => {
    if (!app) return;
    const res = await api.get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('F4.2 GET /api/v1/experiments pagination and filters', async () => {
    if (!app) return;
    const res = await api.get('/api/v1/experiments?page=1&limit=5&target=foo&status=completed');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page', 1);
    expect(res.body).toHaveProperty('limit', 5);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  test('Experiment lifecycle via API', async () => {
    if (!app) return;

    const config: ExperimentConfig = {
      experimentId: 'API-TEST-1',
      target: 'api.test.ts',
      projectPath: '/',
      runsPerCondition: 1,
      conditionDefs: { 'base': { id: 'base', name: 'Base', env: {}, args: [] } },
      conditions: ['base'],
      timeoutMs: 1000
    };

    // Create
    let res = await api.post('/api/v1/experiments').send(config);
    expect(res.status).toBe(201);
    expect(res.body.experimentId).toBe('API-TEST-1');

    // Get
    res = await api.get('/api/v1/experiments/API-TEST-1');
    expect(res.status).toBe(200);
    expect(res.body.config.target).toBe('api.test.ts');

    // Observation
    const obs: Observation = {
      observationId: 'API-TEST-1-base-1',
      experimentId: 'API-TEST-1',
      conditionId: 'base',
      runNumber: 1,
      startedAt: new Date().toISOString(),
      durationMs: 100,
      processStatus: 'success',
      testResults: [],
      environment: { nodeVersion: '20', platform: 'linux', arch: 'x64', timezone: 'UTC', args: [] }
    };

    res = await api.post('/api/v1/experiments/API-TEST-1/observations').send([obs]);
    expect(res.status).toBe(201);

    // Idempotency: Post same observation again
    res = await api.post('/api/v1/experiments/API-TEST-1/observations').send([obs]);
    expect(res.status).toBe(201); // Should not conflict

    // Get observations
    res = await api.get('/api/v1/experiments/API-TEST-1/observations');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1); // Deduplicated in DB

    // Diagnose (Backend performs diagnosis cleanly without mutating DB logic)
    res = await api.post('/api/v1/experiments/API-TEST-1/diagnose');
    expect(res.status).toBe(201);
    expect(res.body.classification).toBe('INSUFFICIENT_EVIDENCE'); // Only 1 observation

    // Get diagnosis
    res = await api.get('/api/v1/experiments/API-TEST-1/diagnosis');
    expect(res.status).toBe(200);
    expect(res.body.classification).toBe('INSUFFICIENT_EVIDENCE');
  });

  test('API Validation errors', async () => {
    if (!app) return;

    // Missing payload
    let res = await api.post('/api/v1/experiments').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');

    // Unknown experiment
    res = await api.get('/api/v1/experiments/UNKNOWN');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('EXPERIMENT_NOT_FOUND');
  });

  test('API Validation errors - Adversarial', async () => {
    if (!app) return;

    // Base valid config to mutate
    const baseConfig: any = {
      experimentId: 'API-ADV-1',
      target: 'api.test.ts',
      projectPath: '/',
      runsPerCondition: 1,
      conditionDefs: { 'base': { id: 'base', name: 'Base', env: {}, args: [] } },
      conditions: ['base'],
      timeoutMs: 1000
    };

    // concurrency: -1
    let res = await api.post('/api/v1/experiments').send({ ...baseConfig, concurrency: -1 });
    expect(res.status).toBe(400);

    // concurrency: 999999
    res = await api.post('/api/v1/experiments').send({ ...baseConfig, concurrency: 999999 });
    expect(res.status).toBe(400);

    // timeoutMs: -500
    res = await api.post('/api/v1/experiments').send({ ...baseConfig, timeoutMs: -500 });
    expect(res.status).toBe(400);

    // timeoutMs: string
    res = await api.post('/api/v1/experiments').send({ ...baseConfig, timeoutMs: '5000' });
    expect(res.status).toBe(400);

    // runsPerCondition: null
    res = await api.post('/api/v1/experiments').send({ ...baseConfig, runsPerCondition: null });
    expect(res.status).toBe(400);

    // retryPolicy: { maxRetries: -100 }
    res = await api.post('/api/v1/experiments').send({ ...baseConfig, retryPolicy: { maxRetries: -100 } });
    expect(res.status).toBe(400);

    // retryPolicy: { maxRetries: '5' }
    res = await api.post('/api/v1/experiments').send({ ...baseConfig, retryPolicy: { maxRetries: '5' } });
    expect(res.status).toBe(400);
  });

  test('API execution and cancellation', async () => {
    if (!app) return;

    const config: ExperimentConfig = {
      experimentId: 'API-EXEC-1',
      target: 'test/fixtures/hang.test.ts',
      projectPath: process.cwd(),
      runsPerCondition: 1,
      conditionDefs: { 'c1': { id: 'c1', name: 'C1', env: {}, args: ['-c', 'vitest.worker.config.ts'] } },
      conditions: ['c1'],
      timeoutMs: 30000
    };

    let res = await api.post('/api/v1/experiments').send(config);
    expect(res.status).toBe(201);

    res = await api.post('/api/v1/experiments/API-EXEC-1/execute');
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('running');

    // Try starting again
    res = await api.post('/api/v1/experiments/API-EXEC-1/execute');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');

    // Cancel
    res = await api.post('/api/v1/experiments/API-EXEC-1/cancel');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');

    // Cancel again -> not running
    res = await api.post('/api/v1/experiments/API-EXEC-1/cancel');
    expect(res.status).toBe(409);
  });
});
