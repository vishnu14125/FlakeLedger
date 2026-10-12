import { expect, test, describe } from 'vitest';
import { runExperiment } from '../src/orchestrator/index';
import { LocalFileExperimentRepository } from '../src/local-repository';
import { ExperimentConfig } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Data Safety & Security', () => {
  test('process.env secrets are NOT persisted in observations', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flakeledger-safety-'));
    const repo = new LocalFileExperimentRepository(tempDir);

    const config: ExperimentConfig = {
      experimentId: 'SEC-TEST',
      target: 'dummy',
      projectPath: '/',
      runsPerCondition: 1,
      conditionDefs: {
        'base': { id: 'base', name: 'Base', env: {}, args: [] }
      },
      conditions: ['base'],
      timeoutMs: 1000
    };

    // Inject a fake secret into process.env before running the orchestrator
    process.env['FLAKELEDGER_FAKE_SECRET'] = 'super-secret-token-12345';

    try {
      // We don't actually want to spawn vitest in this unit test since 'dummy' doesn't exist, 
      // but wait, runExperiment tries to spawn Vitest. It will just fail gracefully as a PROCESS_FAILURE.
      await runExperiment(config, repo);
    } catch (e) {
      // Ignore execution errors, we just want to inspect the persisted data
    }

    const obsFile = path.join(tempDir, '.flakeledger', 'experiments', 'SEC-TEST', 'observations.json');
    const content = fs.readFileSync(obsFile, 'utf-8');

    // The token should NOT exist anywhere in the written file
    expect(content).not.toContain('super-secret-token-12345');
    expect(content).not.toContain('FLAKELEDGER_FAKE_SECRET');

    // Clean up
    delete process.env['FLAKELEDGER_FAKE_SECRET'];
    fs.rmSync(tempDir, { recursive: true, force: true });
  }, 30000);
});
