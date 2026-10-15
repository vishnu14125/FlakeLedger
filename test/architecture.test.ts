import { expect, test, describe } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Phase 7 Architectural Constraints', () => {
  const readSource = (filename: string) => fs.readFileSync(path.join(process.cwd(), 'src', filename), 'utf8');

  test('API boundary (api.ts) does not directly access PostgreSQL', () => {
    const apiCode = readSource('api.ts');
    expect(apiCode).not.toMatch(/new Client\(/);
    expect(apiCode).not.toMatch(/new Pool\(/);
    expect(apiCode).not.toMatch(/pglite/i);
    expect(apiCode).not.toMatch(/\.query\(/);
  });

  test('API boundary (api.ts) does not spawn child processes directly', () => {
    const apiCode = readSource('api.ts');
    expect(apiCode).not.toMatch(/spawn\(/);
    expect(apiCode).not.toMatch(/exec\(/);
    expect(apiCode).not.toMatch(/child_process/);
  });

  test('API boundary (api.ts) does not implement diagnosis directly', () => {
    const apiCode = readSource('api.ts');
    // It should just call service.runDiagnosis
    expect(apiCode).not.toMatch(/analyzeExperiment/);
    expect(apiCode).not.toMatch(/categorizeDiagnosis/);
    expect(apiCode).toMatch(/service\.runDiagnosis\(/);
  });

  test('Orchestrator never runs the runner through a shell', () => {
    const dir = path.join(process.cwd(), 'src', 'orchestrator');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const code = fs
        .readFileSync(path.join(dir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
        .replace(/^\s*\/\/.*$/gm, ''); // line comments
      // `shell: true` makes target/args shell syntax; `npx` implies a shell on Windows.
      expect(code, file).not.toMatch(/shell\s*:\s*true/);
      expect(code, file).not.toMatch(/spawn\(\s*['"]npx/);
      expect(code, file).not.toMatch(/\bexec(Sync)?\(/);
    }
  });

  test('Service boundary (service.ts) does not depend on Express req/res', () => {
    const serviceCode = readSource('service.ts');
    expect(serviceCode).not.toMatch(/express/i);
    expect(serviceCode).not.toMatch(/req:/);
    expect(serviceCode).not.toMatch(/res:/);
    expect(serviceCode).not.toMatch(/Request/);
    expect(serviceCode).not.toMatch(/Response/);
  });
});
