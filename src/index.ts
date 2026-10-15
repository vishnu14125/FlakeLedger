import { runExperiment } from './orchestrator/index';
import { LocalFileExperimentRepository } from './local-repository';
import { ApiExperimentRepository } from './api-repository';
import { IExperimentRepository } from './repository';
import { analyzeExperiment } from './diagnosis';
import { parseArgs } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { ExperimentConfig, Condition } from './types';

// Load .env so CLI can read FLAKELEDGER_API_URL
dotenv.config({ path: path.join(process.cwd(), '.env') });

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      runs: { type: 'string', default: '10' },
      timeout: { type: 'string', default: '30000' },
      conditions: { type: 'string', default: '' },
      projectPath: { type: 'string', default: process.cwd() },
      config: { type: 'string' },
      'fail-on': { type: 'string' },
      'report-format': { type: 'string', default: 'json,md' },
    },
    allowPositionals: true
  });

  const command = positionals[0];
  const target = positionals[1];

  let repo: IExperimentRepository;
  const apiUrl = process.env.FLAKELEDGER_API_URL;
  const apiKey = process.env.FLAKELEDGER_API_KEY;
  if (apiUrl) {
    repo = new ApiExperimentRepository(apiUrl, apiKey);
  } else {
    repo = new LocalFileExperimentRepository(path.resolve(values.projectPath as string));
  }

  if (command === 'history') {
    const experiments = await repo.listExperiments({ limit: 100 });
    console.log(`\nFlakeLedger Experiment History`);
    console.log(`────────────────────────────────`);
    for (const exp of experiments.items) {
      const diag = await repo.getDiagnosis(exp.experimentId);
      const classification = diag ? diag.classification : 'NO_DIAGNOSIS';
      console.log(`${exp.experimentId.padEnd(20)} | ${new Date(exp.createdAt).toLocaleString().padEnd(22)} | ${exp.config.target.padEnd(25)} | ${classification}`);
    }
    process.exit(0);
  }

  if (command === 'show') {
    if (!target) {
      console.error('Usage: flakeledger show <experiment-id>');
      process.exit(1);
    }
    const meta = await repo.getMetadata(target);
    if (!meta) {
      console.error(`Experiment ${target} not found`);
      process.exit(1);
    }
    const diag = await repo.getDiagnosis(target);
    
    console.log(`\nExperiment ID: ${meta.experimentId}`);
    console.log(`Target:        ${meta.config.target}`);
    console.log(`Created:       ${new Date(meta.createdAt).toLocaleString()}`);
    console.log(`Status:        ${meta.status}`);
    console.log(`\nConditions:`);
    for (const c of meta.config.conditions) {
      console.log(`  - ${c}`);
    }

    if (meta.summary) {
      console.log(`\nObservation Summary:`);
      for (const [cond, stats] of Object.entries(meta.summary)) {
        console.log(`  ${cond.padEnd(25)} ${stats.pass} PASS / ${stats.fail} FAIL ${stats.process_failure > 0 ? `(${stats.process_failure} ERRORS)` : ''}`);
      }
    }

    if (diag) {
      console.log(`\nDiagnosis:`);
      console.log(`  Classification: ${diag.classification}`);
      console.log(`  Confidence:     ${diag.confidence}`);
      console.log(`  Why:            ${diag.evidence.explanation.join(' ')}`);
    } else {
      console.log(`\nDiagnosis: None (Run 'flakeledger diagnose ${target}' to generate)`);
    }
    process.exit(0);
  }

  if (command === 'diagnose') {
    if (!target) {
      console.error('Usage: flakeledger diagnose <experiment-id>');
      process.exit(1);
    }
    
    const expId = target.replace('.json', ''); // Handle accidentally passing .json
    const meta = await repo.getMetadata(expId);
    if (!meta) {
      console.error(`Experiment ${expId} not found`);
      process.exit(1);
    }
    
    const obs = await repo.getObservations(expId);
    const diagnosis = analyzeExperiment(meta.config, obs);
    await repo.saveDiagnosis(expId, diagnosis);

    console.log(`\nFlakeLedger Diagnosis`);
    console.log(`────────────────────────────────`);
    console.log(`Test:\n${diagnosis.target}\n`);
    console.log(`Classification:\n${diagnosis.classification}\n`);
    console.log(`Confidence:\n${diagnosis.confidence}\n`);
    console.log(`Why:\n${diagnosis.evidence.explanation.join('\n')}\n`);
    console.log(`Evidence:`);
    
    for (const m of diagnosis.evidence.conditionMetrics) {
      console.log(`${m.conditionId.padEnd(25)} ${m.passes} PASS / ${m.failures} FAIL ${m.processFailures > 0 ? `(${m.processFailures} PROCESS ERRORS)` : ''}`);
    }

    console.log(`\nFailure Fingerprint:`);
    let foundHashes = false;
    for (const m of diagnosis.evidence.conditionMetrics) {
      if (m.dominantHash) {
        foundHashes = true;
        console.log(`${m.conditionId}: ${m.dominantHash} — ${(m.dominantHashFrequency * 100).toFixed(0)}% of failures`);
      }
    }
    if (!foundHashes) console.log(`No failure fingerprints recorded.`);
    console.log(`\nDiagnosis saved.`);
    process.exit(0);
  }

  if (command === 'migrate') {
    if (!apiUrl) {
      console.error('Cannot migrate: FLAKELEDGER_API_URL is not set in .env');
      process.exit(1);
    }
    console.log(`Starting migration to API backend: ${apiUrl}`);
    const localRepo = new LocalFileExperimentRepository(path.resolve(values.projectPath as string));
    const expsResult = await localRepo.listExperiments({ limit: 100 });
    const exps = expsResult.items;
    console.log(`Found ${exps.length} local experiments.`);
    
    let migrated = 0;
    for (const exp of exps) {
      try {
        const remoteMeta = await repo.getMetadata(exp.experimentId);
        if (remoteMeta) {
          console.log(`Skipping ${exp.experimentId} (already exists remotely)`);
          continue;
        }
        
        console.log(`Migrating ${exp.experimentId}...`);
        await repo.createExperiment(exp.config);
        
        const obs = await localRepo.getObservations(exp.experimentId);
        if (obs.length > 0) {
          await repo.saveObservations(exp.experimentId, obs);
        }
        
        const diag = await localRepo.getDiagnosis(exp.experimentId);
        if (diag) {
          // This will trigger the remote diagnosis computation using the newly uploaded observations
          await repo.saveDiagnosis(exp.experimentId, diag);
        }
        
        await repo.updateMetadata(exp.experimentId, { status: exp.status, summary: exp.summary });
        migrated++;
      } catch (e: any) {
        console.error(`Failed to migrate ${exp.experimentId}: ${e.message}`);
      }
    }
    
    console.log(`\nMigration complete. Successfully migrated ${migrated} experiments.`);
    console.log(`Local data was preserved. You can safely remove .flakeledger/experiments if desired.`);
    process.exit(0);
  }

  if (command === 'ci') {
    if (!target) {
      console.error('Usage: flakeledger ci <target> [--runs 10] [--config config.json] [--fail-on=CONCURRENCY_SENSITIVE] [--report-format=json,md]');
      process.exit(1);
    }
    
    // Config parsing identical to investigate
    let conditionDefs: Record<string, Condition> = {};
    if (values.config) {
      const configPath = path.resolve(values.config as string);
      if (fs.existsSync(configPath)) {
        const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (userConfig.conditions) conditionDefs = userConfig.conditions;
      }
    }
    if (Object.keys(conditionDefs).length === 0) {
      conditionDefs = {
        baseline: { id: 'baseline', name: 'Baseline', env: {}, args: [] },
        timezone: { id: 'timezone', name: 'Timezone', type: 'environment', env: { TZ: 'America/New_York' }, args: [] },
        order: { id: 'order', name: 'Order', type: 'order', env: {}, args: ['--sequence.shuffle', '--sequence.seed=3'] },
        concurrency: { id: 'concurrency', name: 'Concurrency', type: 'concurrency', env: {}, args: ['--no-file-parallelism'] }
      };
    }
    const conditionList = values.conditions ? (values.conditions as string).split(',') : Object.keys(conditionDefs);

    const config: ExperimentConfig = {
      experimentId: `CI-EXP-${Date.now()}`,
      target,
      projectPath: path.resolve(values.projectPath as string),
      runsPerCondition: parseInt(values.runs as string, 10),
      conditionDefs,
      conditions: conditionList,
      timeoutMs: parseInt(values.timeout as string, 10)
    };

    console.log(`\n======================================================`);
    console.log(` FlakeLedger CI Investigation`);
    console.log(`======================================================`);
    console.log(` Target:     ${config.target}`);
    console.log(` Experiment: ${config.experimentId}`);
    console.log(` Runs:       ${config.runsPerCondition}`);
    console.log(` Conditions: ${config.conditions.join(', ')}`);
    console.log(`======================================================\n`);

    // 1. Run the experiment
    const meta = await runExperiment(config, repo);
    
    // 2. Generate diagnosis natively (offline/online)
    const obs = await repo.getObservations(config.experimentId);
    const diagnosis = analyzeExperiment(config, obs);
    await repo.saveDiagnosis(config.experimentId, diagnosis);
    
    const formats = (values['report-format'] as string).split(',');

    // 3. Generate JSON report
    if (formats.includes('json')) {
      const report = {
        experiment: meta,
        observations: obs,
        diagnosis
      };
      fs.writeFileSync('flakeledger-report.json', JSON.stringify(report, null, 2));
      console.log(`\n[+] Generated flakeledger-report.json`);
    }

    // 4. Generate Markdown report
    if (formats.includes('md')) {
      let md = `# FlakeLedger Investigation\n\n`;
      md += `## Target\n\`${config.target}\`\n\n`;
      md += `## Result\n**${diagnosis.classification}** (Confidence: ${diagnosis.confidence})\n\n`;
      md += `## Evidence\n| Condition | Total | Pass | Fail | Failure Rate |\n|---|---|---|---|---|\n`;
      for (const m of diagnosis.evidence.conditionMetrics) {
        md += `| ${m.conditionId} | ${m.totalRuns} | ${m.passes} | ${m.failures} | ${(m.failureRate * 100).toFixed(0)}% |\n`;
      }
      md += `\n## Explanation\n${diagnosis.evidence.explanation.map(e => `- ${e}`).join('\n')}\n`;
      if (diagnosis.limitations) {
        md += `\n## Limitations\n${diagnosis.limitations}\n`;
      }
      fs.writeFileSync('flakeledger-report.md', md);
      console.log(`[+] Generated flakeledger-report.md`);
    }
    
    // 5. Output Summary to Terminal
    console.log(`\n------------------------------------------------------`);
    console.log(`Diagnosis:  ${diagnosis.classification}`);
    console.log(`Confidence: ${diagnosis.confidence}`);
    console.log(`------------------------------------------------------`);

    // 6. Handle Exit Code
    const failOn = values['fail-on'] as string;
    if (failOn) {
      const failTypes = failOn.split(',');
      if (failTypes.includes(diagnosis.classification)) {
        console.error(`\n[!] CI Build Failed: FlakeLedger detected ${diagnosis.classification} which matches --fail-on criteria.`);
        process.exit(1);
      }
    }
    
    console.log(`\n[+] Investigation completed successfully.`);
    process.exit(0);
  }

  if (command !== 'investigate' || !target) {
    console.error('Usage: \n  flakeledger investigate <target> [--runs 10] [--config flakeledger.config.json]\n  flakeledger ci <target> [--runs 10] [--fail-on=...]\n  flakeledger diagnose <experiment-id>\n  flakeledger history\n  flakeledger show <experiment-id>\n  flakeledger migrate');
    process.exit(1);
  }

  // Load custom conditions or use a default generic set
  let conditionDefs: Record<string, Condition> = {};
  if (values.config) {
    const configPath = path.resolve(values.config as string);
    if (!fs.existsSync(configPath)) {
      console.error(`Config file not found: ${configPath}`);
      process.exit(1);
    }
    const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (userConfig.conditions) {
      conditionDefs = userConfig.conditions;
    }
  } else {
    // Default generic condition definitions for convenience if no config provided
    conditionDefs = {
      baseline: { id: 'baseline', name: 'Baseline', env: {}, args: [] },
      timezone: { id: 'timezone', name: 'Timezone (New_York)', type: 'environment', env: { TZ: 'America/New_York' }, args: [] },
      order: { id: 'order', name: 'Order (Shuffle)', type: 'order', env: {}, args: ['--sequence.shuffle', '--sequence.seed=3'] },
      concurrency: { id: 'concurrency', name: 'Concurrency (Serial)', type: 'concurrency', env: {}, args: ['--no-file-parallelism'] }
    };
  }

  let conditionList = values.conditions ? (values.conditions as string).split(',') : Object.keys(conditionDefs);

  const config: ExperimentConfig = {
    experimentId: `EXP-${Date.now()}`,
    target,
    projectPath: path.resolve(values.projectPath as string),
    runsPerCondition: parseInt(values.runs as string, 10),
    conditionDefs,
    conditions: conditionList,
    timeoutMs: parseInt(values.timeout as string, 10)
  };

  console.log(`\nFlakeLedger Investigation`);
  console.log(`Target: ${config.target}`);
  console.log(`Experiment: ${config.experimentId}`);
  console.log(`Conditions: \n${config.conditions.map(c => `✓ ${c}`).join('\n')}`);
  console.log(`Runs: ${config.runsPerCondition} per condition\n`);

  await runExperiment(config, repo);
  const metadata = await repo.getMetadata(config.experimentId);

  console.log('\nObservations:');
  for (const [cond, stats] of Object.entries(metadata?.summary || {})) {
    const errorString = stats.process_failure > 0 ? ` / ${stats.process_failure} ERRORS` : '';
    console.log(`${cond.padEnd(15)} ${stats.pass} PASS / ${stats.fail} FAIL${errorString}`);
  }

  console.log(`\nExperiment persisted successfully. Run 'flakeledger diagnose ${config.experimentId}' to classify.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
