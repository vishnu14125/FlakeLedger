import express from 'express';
import cors from 'cors';
import { createHash, timingSafeEqual } from 'crypto';
import { ExperimentService } from './service';
import { validateExperimentConfig } from './validator';
import { DEFAULT_ALLOWED_ORIGINS } from './server-config';

export interface ApiOptions {
  /**
   * Bearer token required on every route except `/health`. When absent, only
   * read-only (GET/HEAD) routes are served and every route that creates,
   * changes, executes or cancels an investigation is refused.
   */
  apiKey?: string;
  /** Browser origins allowed by CORS. CORS is not authentication. */
  allowedOrigins?: string[];
  /** If set, requests whose Host header is not listed are refused (DNS rebinding). */
  allowedHosts?: string[];
}

const digest = (value: string) => createHash('sha256').update(value).digest();

function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  // "[::1]:4000" -> "[::1]"; "localhost:4000" -> "localhost"
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']');
    return end === -1 ? hostHeader : hostHeader.slice(0, end + 1);
  }
  return hostHeader.split(':')[0];
}

export function createApi(service: ExperimentService, options: ApiOptions = {}) {
  const app = express();
  app.disable('x-powered-by');

  const keyDigest = options.apiKey ? digest(options.apiKey) : null;
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  const allowedHosts = options.allowedHosts?.map((h) => h.toLowerCase());

  if (allowedHosts) {
    app.use((req, res, next) => {
      if (!allowedHosts.includes(hostnameOf(req.headers.host).toLowerCase())) {
        return res.status(403).json({ error: { code: 'HOST_NOT_ALLOWED', message: 'Host header not allowed' } });
      }
      next();
    });
  }

  app.use(
    cors({
      origin: allowedOrigins,
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    }),
  );

  // Liveness only; reveals nothing about the data.
  app.get('/api/v1/health', (req, res) => {
    res.json({ status: 'ok', database: 'reachable' });
  });

  // Everything below requires authentication. This runs before the body parser
  // so unauthenticated callers cannot make the server parse large payloads.
  app.use('/api/v1', (req, res, next) => {
    if (!keyDigest) {
      if (req.method === 'GET' || req.method === 'HEAD') return next();
      return res.status(403).json({
        error: {
          code: 'API_KEY_NOT_CONFIGURED',
          message: 'This server has no API key configured, so it only serves read requests. Set FLAKELEDGER_API_KEY to enable changes and execution.',
        },
      });
    }

    const match = (req.headers.authorization ?? '').match(/^Bearer (.+)$/i);
    if (match && timingSafeEqual(digest(match[1]), keyDigest)) return next();

    res.setHeader('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid API key' } });
  });

  app.use(express.json({ limit: '10mb' }));

  app.get('/api/v1/experiments', async (req, res) => {
    try {
      const options: any = {};

      if (req.query.page) {
        const p = parseInt(req.query.page as string, 10);
        if (!isNaN(p) && p > 0) options.page = p;
      }
      if (req.query.limit) {
        const l = parseInt(req.query.limit as string, 10);
        if (!isNaN(l) && l > 0) options.limit = l;
      }
      if (req.query.target) options.target = req.query.target as string;

      if (req.query.status) {
        options.status = Array.isArray(req.query.status) ? req.query.status : [req.query.status];
      }
      if (req.query.classification) {
        options.classification = Array.isArray(req.query.classification) ? req.query.classification : [req.query.classification];
      }

      const exps = await service.listExperiments(options);
      res.json(exps);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  app.post('/api/v1/experiments', async (req, res) => {
    try {
      validateExperimentConfig(req.body);
      const exp = await service.createExperiment(req.body);
      res.status(201).json(exp);
    } catch (err: any) {
      if (err.message.includes('already exists') || err.message.includes('unique constraint')) {
        return res.status(409).json({ error: { code: 'CONFLICT', message: 'Experiment already exists' } });
      }
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
  });

  app.get('/api/v1/experiments/:id', async (req, res) => {
    try {
      const exp = await service.getExperiment(req.params.id);
      res.json(exp);
    } catch (err: any) {
      if (err.message === 'EXPERIMENT_NOT_FOUND') return res.status(404).json({ error: { code: 'EXPERIMENT_NOT_FOUND', message: 'Experiment not found' } });
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  // Lifecycle fields only (`status`, `summary`). The configuration an
  // investigation executes is immutable after creation.
  app.put('/api/v1/experiments/:id', async (req, res) => {
    try {
      await service.updateExperiment(req.params.id, req.body);
      res.json({ status: 'updated' });
    } catch (err: any) {
      if (err.message === 'INVALID_UPDATE') {
        return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Only status and summary can be updated' } });
      }
      if (err.message === 'EXPERIMENT_NOT_FOUND' || /not found/i.test(err.message)) {
        return res.status(404).json({ error: { code: 'EXPERIMENT_NOT_FOUND', message: 'Experiment not found' } });
      }
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  app.post('/api/v1/experiments/:id/execute', async (req, res) => {
    try {
      await service.executeExperiment(req.params.id);
      res.status(202).json({ status: 'running' }); // Async start
    } catch (err: any) {
      if (err.message === 'EXPERIMENT_NOT_FOUND') return res.status(404).json({ error: { code: 'EXPERIMENT_NOT_FOUND', message: 'Experiment not found' } });
      if (err.message === 'EXPERIMENT_ALREADY_RUNNING') return res.status(409).json({ error: { code: 'CONFLICT', message: 'Experiment is already running' } });
      if (typeof err.message === 'string' && err.message.startsWith('INVALID_CONFIG')) {
        return res.status(400).json({ error: { code: 'INVALID_CONFIG', message: err.message.replace(/^INVALID_CONFIG: /, '') } });
      }
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  app.post('/api/v1/experiments/:id/cancel', async (req, res) => {
    try {
      await service.cancelExperiment(req.params.id);
      res.json({ status: 'cancelled' });
    } catch (err: any) {
      if (err.message === 'EXPERIMENT_NOT_FOUND') return res.status(404).json({ error: { code: 'EXPERIMENT_NOT_FOUND', message: 'Experiment not found' } });
      if (err.message === 'EXPERIMENT_NOT_RUNNING') return res.status(409).json({ error: { code: 'CONFLICT', message: 'Experiment is not actively running' } });
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  app.post('/api/v1/experiments/:id/observations', async (req, res) => {
    try {
      if (!Array.isArray(req.body)) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Expected array of observations' } });
      await service.saveObservations(req.params.id, req.body);
      res.status(201).json({ status: 'saved' });
    } catch (err: any) {
      if (err.message === 'OBSERVATION_MISMATCH') return res.status(400).json({ error: { code: 'OBSERVATION_MISMATCH', message: 'Observation ID mismatch' } });
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  app.get('/api/v1/experiments/:id/observations', async (req, res) => {
    try {
      const obs = await service.getObservations(req.params.id);
      res.json(obs);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  app.get('/api/v1/experiments/:id/observations/:observationId/terminal', async (req, res) => {
    try {
      const terminal = await service.getObservationTerminal(req.params.id, req.params.observationId);
      if (!terminal) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Terminal evidence not found' } });
      res.json(terminal);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  app.get('/api/v1/experiments/:id/diagnosis', async (req, res) => {
    try {
      const diag = await service.getDiagnosis(req.params.id);
      if (!diag) return res.status(404).json({ error: { code: 'DIAGNOSIS_NOT_FOUND', message: 'Diagnosis not found' } });
      res.json(diag);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  app.post('/api/v1/experiments/:id/diagnose', async (req, res) => {
    try {
      const diag = await service.runDiagnosis(req.params.id);
      res.status(201).json(diag);
    } catch (err: any) {
      if (err.message === 'EXPERIMENT_NOT_FOUND') return res.status(404).json({ error: { code: 'EXPERIMENT_NOT_FOUND', message: 'Experiment not found' } });
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  return app;
}
