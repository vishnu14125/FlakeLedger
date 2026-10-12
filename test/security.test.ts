import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createApi } from '../src/api';
import { ExperimentService } from '../src/service';
import { LocalFileExperimentRepository } from '../src/local-repository';
import { resolveServerConfig } from '../src/server-config';
import { validateExperimentConfig } from '../src/validator';
import { ExperimentConfig } from '../src/types';

const KEY = 'unit-test-api-key-0123456789';
const GOOD_ORIGIN = 'http://localhost:5173';

function validConfig(overrides: Partial<ExperimentConfig> = {}): ExperimentConfig {
  return {
    experimentId: 'SEC-1',
    target: 'src/a.test.ts',
    projectPath: process.cwd(),
    runsPerCondition: 1,
    conditionDefs: { base: { id: 'base', name: 'Base', env: {}, args: [] } },
    conditions: ['base'],
    timeoutMs: 1000,
    argsFormat: 'argv',
    ...overrides,
  };
}

describe('API authentication', () => {
  let dir: string;
  let repo: LocalFileExperimentRepository;
  let service: ExperimentService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flakeledger-sec-'));
    repo = new LocalFileExperimentRepository(dir);
    service = new ExperimentService(repo);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const bearer = (k = KEY) => ({ Authorization: `Bearer ${k}` });

  describe('with an API key configured', () => {
    test('rejects every protected route without credentials', async () => {
      const app = createApi(service, { apiKey: KEY });
      const calls: Array<[string, string]> = [
        ['get', '/api/v1/experiments'],
        ['post', '/api/v1/experiments'],
        ['get', '/api/v1/experiments/SEC-1'],
        ['put', '/api/v1/experiments/SEC-1'],
        ['post', '/api/v1/experiments/SEC-1/execute'],
        ['post', '/api/v1/experiments/SEC-1/cancel'],
        ['post', '/api/v1/experiments/SEC-1/observations'],
        ['get', '/api/v1/experiments/SEC-1/observations'],
        ['get', '/api/v1/experiments/SEC-1/observations/x/terminal'],
        ['post', '/api/v1/experiments/SEC-1/diagnose'],
        ['get', '/api/v1/experiments/SEC-1/diagnosis'],
      ];
      for (const [method, url] of calls) {
        const res = await (request(app) as any)[method](url).send({});
        expect(res.status, `${method} ${url}`).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
        expect(res.headers['www-authenticate']).toBe('Bearer');
      }
    });

    test('rejects wrong, malformed and non-bearer credentials', async () => {
      const app = createApi(service, { apiKey: KEY });
      for (const header of [`Bearer ${KEY}x`, `Bearer ${KEY.slice(1)}`, 'Bearer ', KEY, `Basic ${KEY}`, 'Bearer']) {
        const res = await request(app).get('/api/v1/experiments').set('Authorization', header);
        expect(res.status, header).toBe(401);
      }
    });

    test('accepts the correct key (scheme is case-insensitive)', async () => {
      const app = createApi(service, { apiKey: KEY });
      let res = await request(app).get('/api/v1/experiments').set(bearer());
      expect(res.status).toBe(200);
      res = await request(app).get('/api/v1/experiments').set('Authorization', `bearer ${KEY}`);
      expect(res.status).toBe(200);
    });

    test('health stays open and discloses nothing', async () => {
      const app = createApi(service, { apiKey: KEY });
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(KEY);
    });

    test('an unauthenticated create with a malicious config persists nothing', async () => {
      const app = createApi(service, { apiKey: KEY });
      const evil = validConfig({ experimentId: 'EVIL', target: 'x; touch pwned' });
      const res = await request(app).post('/api/v1/experiments').send(evil);
      expect(res.status).toBe(401);
      expect(await repo.getMetadata('EVIL')).toBeNull();
    });

    test('the key never appears in error bodies', async () => {
      const app = createApi(service, { apiKey: KEY });
      const res = await request(app).post('/api/v1/experiments').set(bearer()).send({});
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(KEY);
    });
  });

  describe('with no API key configured', () => {
    test('serves reads but refuses every state-changing and executing route', async () => {
      const app = createApi(service);
      expect((await request(app).get('/api/v1/experiments')).status).toBe(200);

      const calls: Array<[string, string]> = [
        ['post', '/api/v1/experiments'],
        ['put', '/api/v1/experiments/SEC-1'],
        ['post', '/api/v1/experiments/SEC-1/execute'],
        ['post', '/api/v1/experiments/SEC-1/cancel'],
        ['post', '/api/v1/experiments/SEC-1/observations'],
        ['post', '/api/v1/experiments/SEC-1/diagnose'],
      ];
      for (const [method, url] of calls) {
        const res = await (request(app) as any)[method](url).send(validConfig());
        expect(res.status, `${method} ${url}`).toBe(403);
        expect(res.body.error.code).toBe('API_KEY_NOT_CONFIGURED');
      }
      expect(await repo.getMetadata('SEC-1')).toBeNull();
    });
  });

  describe('immutable configuration', () => {
    test('PUT cannot replace config; lifecycle fields still update', async () => {
      const app = createApi(service, { apiKey: KEY });
      let res = await request(app).post('/api/v1/experiments').set(bearer()).send(validConfig());
      expect(res.status).toBe(201);

      const tampered = { ...validConfig(), target: 'x; touch pwned', argsFormat: undefined };
      res = await request(app).put('/api/v1/experiments/SEC-1').set(bearer()).send({ config: tampered });
      expect(res.status).toBe(400);
      expect((await repo.getMetadata('SEC-1'))!.config.target).toBe('src/a.test.ts');

      // status alongside config is still refused as a whole
      res = await request(app).put('/api/v1/experiments/SEC-1').set(bearer()).send({ status: 'completed', config: tampered });
      expect(res.status).toBe(400);
      expect((await repo.getMetadata('SEC-1'))!.status).toBe('created');

      res = await request(app).put('/api/v1/experiments/SEC-1').set(bearer()).send({ status: 'bogus' });
      expect(res.status).toBe(400);

      res = await request(app).put('/api/v1/experiments/SEC-1').set(bearer()).send({ status: 'completed' });
      expect(res.status).toBe(200);
      expect((await repo.getMetadata('SEC-1'))!.status).toBe('completed');
    });

    test('the local repository itself ignores non-lifecycle updates', async () => {
      await repo.createExperiment(validConfig());
      await repo.updateMetadata('SEC-1', { config: validConfig({ target: 'other' }), status: 'running' } as any);
      const meta = (await repo.getMetadata('SEC-1'))!;
      expect(meta.config.target).toBe('src/a.test.ts');
      expect(meta.status).toBe('running');
    });
  });

  describe('persisted configurations are re-validated before execution', () => {
    test('a tampered record is refused and no runner is started', async () => {
      // Written straight to storage, as an on-disk edit or pre-hotfix record would be.
      const bad = validConfig({
        experimentId: 'TAMPER',
        conditionDefs: { base: { id: 'base', name: 'Base', env: { 'BAD NAME': 'x' }, args: [] } },
      });
      await repo.createExperiment(bad);
      await expect(service.executeExperiment('TAMPER')).rejects.toThrow(/INVALID_CONFIG/);
      expect((await repo.getMetadata('TAMPER'))!.status).toBe('created');
    });

    test('over the API the refusal is a 400, not a 500', async () => {
      const app = createApi(service, { apiKey: KEY });
      await repo.createExperiment(validConfig({ experimentId: 'TAMPER2', projectPath: 'relative/dir' }));
      const res = await request(app).post('/api/v1/experiments/TAMPER2/execute').set(bearer());
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CONFIG');
    });
  });
});

describe('CORS and Host guard', () => {
  let dir: string;
  let service: ExperimentService;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flakeledger-cors-'));
    service = new ExperimentService(new LocalFileExperimentRepository(dir));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('allows only the configured origins', async () => {
    const app = createApi(service, { apiKey: KEY, allowedOrigins: [GOOD_ORIGIN] });

    let res = await request(app).get('/api/v1/health').set('Origin', GOOD_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBe(GOOD_ORIGIN);

    res = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();

    res = await request(app)
      .options('/api/v1/experiments')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('preflight from an allowed origin needs no credentials but never wildcards', async () => {
    const app = createApi(service, { apiKey: KEY, allowedOrigins: [GOOD_ORIGIN] });
    const res = await request(app)
      .options('/api/v1/experiments')
      .set('Origin', GOOD_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(GOOD_ORIGIN);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  test('CORS is not authentication: an allowed origin still needs the key', async () => {
    const app = createApi(service, { apiKey: KEY, allowedOrigins: [GOOD_ORIGIN] });
    const res = await request(app).post('/api/v1/experiments').set('Origin', GOOD_ORIGIN).send(validConfig());
    expect(res.status).toBe(401);
  });

  test('refuses unexpected Host headers when a host allowlist is set (DNS rebinding)', async () => {
    const app = createApi(service, { apiKey: KEY, allowedHosts: ['localhost', '127.0.0.1', '[::1]'] });
    let res = await request(app).get('/api/v1/health').set('Host', 'attacker.example:4000');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('HOST_NOT_ALLOWED');

    res = await request(app).get('/api/v1/health').set('Host', 'localhost:4000');
    expect(res.status).toBe(200);
    res = await request(app).get('/api/v1/health').set('Host', '127.0.0.1:4000');
    expect(res.status).toBe(200);
    res = await request(app).get('/api/v1/health').set('Host', '[::1]:4000');
    expect(res.status).toBe(200);
  });
});

describe('resolveServerConfig', () => {
  test('defaults are loopback-only, read-only and dashboard-origin-only', () => {
    const c = resolveServerConfig({});
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(4000);
    expect(c.apiKey).toBeUndefined();
    expect(c.allowedOrigins).toContain('http://localhost:5173');
    expect(c.allowedOrigins).not.toContain('*');
    expect(c.allowedHosts).toEqual(['localhost', '127.0.0.1', '[::1]']);
  });

  test('refuses to bind a non-loopback interface without an API key', () => {
    expect(() => resolveServerConfig({ FLAKELEDGER_HOST: '0.0.0.0' })).toThrow(/without FLAKELEDGER_API_KEY/);
    expect(() => resolveServerConfig({ FLAKELEDGER_HOST: '10.1.2.3' })).toThrow(/without FLAKELEDGER_API_KEY/);
  });

  test('allows a non-loopback bind when a key is set, and drops the Host allowlist', () => {
    const c = resolveServerConfig({ FLAKELEDGER_HOST: '0.0.0.0', FLAKELEDGER_API_KEY: KEY });
    expect(c.host).toBe('0.0.0.0');
    expect(c.allowedHosts).toBeUndefined();
  });

  test('rejects short keys, wildcard origins, bad origins and bad ports', () => {
    expect(() => resolveServerConfig({ FLAKELEDGER_API_KEY: 'short' })).toThrow(/at least/);
    expect(() => resolveServerConfig({ FLAKELEDGER_ALLOWED_ORIGINS: '*' })).toThrow(/explicit origins/);
    expect(() => resolveServerConfig({ FLAKELEDGER_ALLOWED_ORIGINS: 'not a url' })).toThrow(/invalid origin/);
    expect(() => resolveServerConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => resolveServerConfig({ PORT: '70000' })).toThrow(/PORT/);
  });

  test('parses and normalizes configured origins', () => {
    const c = resolveServerConfig({ FLAKELEDGER_ALLOWED_ORIGINS: 'https://ui.example.com/, http://localhost:3000' });
    expect(c.allowedOrigins).toEqual(['https://ui.example.com', 'http://localhost:3000']);
  });
});

describe('server-side configuration validation', () => {
  const base = () => validConfig();
  const reject = (mutate: (c: any) => void, pattern: RegExp) => {
    const c: any = JSON.parse(JSON.stringify(base()));
    mutate(c);
    expect(() => validateExperimentConfig(c)).toThrow(pattern);
  };

  test('accepts a valid config, with and without argsFormat', () => {
    expect(() => validateExperimentConfig(base())).not.toThrow();
    const legacy: any = base();
    delete legacy.argsFormat;
    expect(() => validateExperimentConfig(legacy)).not.toThrow();
  });

  test('rejects control characters and oversize values in target', () => {
    reject((c) => (c.target = 'a\nb'), /control characters/);
    reject((c) => (c.target = 'a\u0000b'), /control characters/);
    reject((c) => (c.target = 'x'.repeat(2000)), /at most/);
  });

  test('requires an absolute projectPath without control characters', () => {
    reject((c) => (c.projectPath = 'relative/dir'), /absolute/);
    reject((c) => (c.projectPath = '.'), /absolute/);
    reject((c) => (c.projectPath = '/tmp/a\nb'), /control characters/);
  });

  test('rejects malformed env', () => {
    reject((c) => (c.conditionDefs.base.env = { 'BAD NAME': 'x' }), /invalid variable name/);
    reject((c) => (c.conditionDefs.base.env = { '1X': 'x' }), /invalid variable name/);
    reject((c) => (c.conditionDefs.base.env = { TZ: 5 }), /must be strings/);
    reject((c) => (c.conditionDefs.base.env = { TZ: 'a\u0000b' }), /must be strings/);
    reject((c) => (c.conditionDefs.base.env = ['TZ']), /must be an object/);
  });

  test('rejects malformed args', () => {
    reject((c) => (c.conditionDefs.base.args = 'x'), /must be an array/);
    reject((c) => (c.conditionDefs.base.args = [1]), /must be strings/);
    reject((c) => (c.conditionDefs.base.args = ['a\u0000b']), /must be strings/);
    reject((c) => (c.conditionDefs.base.args = Array(100).fill('x')), /too many args/);
  });

  test('looks conditions up by own property only', () => {
    reject((c) => (c.conditions = ['constructor']), /Missing definition/);
    reject((c) => (c.conditions = ['toString']), /Missing definition/);
  });

  test('rejects unknown argsFormat values', () => {
    reject((c) => (c.argsFormat = 'shell'), /argsFormat/);
  });
});
