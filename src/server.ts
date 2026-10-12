import { createApi } from './api';
import { ExperimentService } from './service';
import { PostgresExperimentRepository } from './postgres-repository';
import { LocalFileExperimentRepository } from './local-repository';
import { resolveServerConfig } from './server-config';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const dbUrl = process.env.DATABASE_URL;

async function start() {
  // Throws (and the process exits) on an unsafe combination such as a
  // non-loopback bind without an API key.
  const config = resolveServerConfig(process.env);

  let repo;
  if (dbUrl) {
    repo = new PostgresExperimentRepository(dbUrl);
    console.log('Initializing Postgres Schema...');
    await repo.initializeSchema();
  } else {
    console.log('No DATABASE_URL provided. Falling back to LocalFileExperimentRepository.');
    repo = new LocalFileExperimentRepository(path.join(process.cwd(), '.flakeledger'));
  }

  const service = new ExperimentService(repo);
  const app = createApi(service, {
    apiKey: config.apiKey,
    allowedOrigins: config.allowedOrigins,
    allowedHosts: config.allowedHosts,
  });

  const server = app.listen(config.port, config.host, () => {
    console.log(`FlakeLedger API listening on http://${config.host}:${config.port}`);
    if (config.apiKey) {
      console.log('Authentication: API key required (Authorization: Bearer <FLAKELEDGER_API_KEY>).');
    } else {
      console.warn(
        'Authentication: FLAKELEDGER_API_KEY is not set. The API is read-only; creating, ' +
          'executing and cancelling investigations are disabled until a key is configured.',
      );
    }
  });

  // Runners are child processes; do not leave them behind when the server stops.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal}; cancelling running investigations...`);
    try {
      await service.cancelAll();
    } catch (err) {
      console.error('Error while cancelling investigations:', err);
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch(err => {
  console.error('Failed to start server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
