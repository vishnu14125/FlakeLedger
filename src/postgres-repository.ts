import { Pool } from 'pg';
import { ExperimentConfig, ExperimentMetadata, Observation, ListExperimentsOptions, PaginatedHistory, HistoryItem } from './types';
import { DiagnosisResult } from './diagnosis';
import { IExperimentRepository } from './repository';

// Abstracting the query interface so we can use pg Pool or PGlite for local testing
export interface IDatabaseClient {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
  exec?(sql: string): Promise<void>; // some lightweight drivers use this
}

export class PostgresExperimentRepository implements IExperimentRepository {
  private client: IDatabaseClient;

  constructor(clientOrString: string | IDatabaseClient) {
    if (typeof clientOrString === 'string') {
      this.client = new Pool({ connectionString: clientOrString });
    } else {
      this.client = clientOrString;
    }
  }

  public async initializeSchema(): Promise<void> {
    const schema = `
      CREATE TABLE IF NOT EXISTS experiments (
        id TEXT PRIMARY KEY,
        target TEXT NOT NULL,
        status TEXT NOT NULL,
        config JSONB NOT NULL,
        summary JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
        condition_id TEXT NOT NULL,
        run_number INTEGER NOT NULL,
        process_status TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        test_results JSONB NOT NULL,
        environment JSONB NOT NULL,
        started_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS diagnoses (
        experiment_id TEXT PRIMARY KEY REFERENCES experiments(id) ON DELETE CASCADE,
        classification TEXT NOT NULL,
        confidence TEXT NOT NULL,
        explanation JSONB NOT NULL,
        evidence JSONB NOT NULL,
        limitations TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_observations_experiment_id ON observations(experiment_id);
      CREATE INDEX IF NOT EXISTS idx_experiments_created_at_id ON experiments(created_at DESC, id DESC);
    `;

    if (this.client.exec) {
      await this.client.exec(schema);
    } else {
      await this.client.query(schema);
    }

    const alterSchema = `
      ALTER TABLE observations ADD COLUMN IF NOT EXISTS exit_code INTEGER;
      ALTER TABLE observations ADD COLUMN IF NOT EXISTS stdout TEXT;
      ALTER TABLE observations ADD COLUMN IF NOT EXISTS stderr TEXT;
    `;
    if (this.client.exec) {
      await this.client.exec(alterSchema);
    } else {
      await this.client.query(alterSchema);
    }
  }

  public async createExperiment(config: ExperimentConfig): Promise<ExperimentMetadata> {
    const metadata: ExperimentMetadata = {
      experimentId: config.experimentId,
      createdAt: new Date().toISOString(),
      status: 'created',
      config
    };

    await this.client.query(
      `INSERT INTO experiments (id, target, status, config, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [metadata.experimentId, config.target, metadata.status, JSON.stringify(config), metadata.createdAt]
    );

    return metadata;
  }

  public async getMetadata(experimentId: string): Promise<ExperimentMetadata | null> {
    const res = await this.client.query(`SELECT * FROM experiments WHERE id = $1`, [experimentId]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      experimentId: row.id,
      createdAt: new Date(row.created_at).toISOString(),
      status: row.status as any,
      config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
      summary: typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary
    };
  }

  public async updateMetadata(experimentId: string, updates: Partial<ExperimentMetadata>): Promise<void> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (updates.status) {
      sets.push(`status = $${idx++}`);
      values.push(updates.status);
    }
    if (updates.summary) {
      sets.push(`summary = $${idx++}`);
      values.push(JSON.stringify(updates.summary));
    }

    if (sets.length === 0) return;

    values.push(experimentId);
    await this.client.query(
      `UPDATE experiments SET ${sets.join(', ')} WHERE id = $${idx}`,
      values
    );
  }

  public async saveObservations(experimentId: string, observations: Observation[]): Promise<void> {
    if (observations.length === 0) return;

    try {
      await this.client.query('BEGIN');
      for (const obs of observations) {
        await this.client.query(
          `INSERT INTO observations (id, experiment_id, condition_id, run_number, process_status, duration_ms, test_results, environment, started_at, exit_code, stdout, stderr)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (id) DO NOTHING`,
          [
            obs.observationId,
            obs.experimentId,
            obs.conditionId,
            obs.runNumber,
            obs.processStatus,
            obs.durationMs,
            JSON.stringify(obs.testResults),
            JSON.stringify(obs.environment),
            obs.startedAt,
            obs.exitCode ?? null,
            obs.stdout ?? null,
            obs.stderr ?? null
          ]
        );
      }
      await this.client.query('COMMIT');
    } catch (e) {
      await this.client.query('ROLLBACK');
      throw e;
    }
  }

  public async getObservations(experimentId: string): Promise<Observation[]> {
    const res = await this.client.query(
      `SELECT id, experiment_id, condition_id, run_number, process_status, duration_ms, test_results, environment, started_at, exit_code FROM observations WHERE experiment_id = $1 ORDER BY started_at ASC`,
      [experimentId]
    );
    return res.rows.map((row: any) => ({
      observationId: row.id,
      experimentId: row.experiment_id,
      conditionId: row.condition_id,
      runNumber: row.run_number,
      processStatus: row.process_status as any,
      durationMs: row.duration_ms,
      testResults: typeof row.test_results === 'string' ? JSON.parse(row.test_results) : row.test_results,
      environment: typeof row.environment === 'string' ? JSON.parse(row.environment) : row.environment,
      startedAt: new Date(row.started_at).toISOString(),
      exitCode: row.exit_code ?? undefined
    }));
  }

  public async getObservationTerminal(experimentId: string, observationId: string): Promise<{stdout?: string, stderr?: string, exitCode?: number | null} | null> {
    const res = await this.client.query(
      `SELECT stdout, stderr, exit_code FROM observations WHERE id = $1 AND experiment_id = $2`,
      [observationId, experimentId]
    );
    if (res.rows.length === 0) return null;
    return {
      stdout: res.rows[0].stdout ?? undefined,
      stderr: res.rows[0].stderr ?? undefined,
      exitCode: res.rows[0].exit_code ?? null
    };
  }

  public async saveDiagnosis(experimentId: string, diagnosis: DiagnosisResult): Promise<void> {
    await this.client.query(
      `INSERT INTO diagnoses (experiment_id, classification, confidence, explanation, evidence, limitations)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (experiment_id) DO UPDATE SET
         classification = EXCLUDED.classification,
         confidence = EXCLUDED.confidence,
         explanation = EXCLUDED.explanation,
         evidence = EXCLUDED.evidence,
         limitations = EXCLUDED.limitations`,
      [
        experimentId,
        diagnosis.classification,
        diagnosis.confidence,
        JSON.stringify(diagnosis.evidence.explanation),
        JSON.stringify({ conditionMetrics: diagnosis.evidence.conditionMetrics, totalObservations: diagnosis.evidence.totalObservations }),
        diagnosis.limitations
      ]
    );
  }

  public async getDiagnosis(experimentId: string): Promise<DiagnosisResult | null> {
    const res = await this.client.query(`SELECT * FROM diagnoses WHERE experiment_id = $1`, [experimentId]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];

    const metaRes = await this.client.query(`SELECT target FROM experiments WHERE id = $1`, [experimentId]);
    const target = metaRes.rows.length > 0 ? metaRes.rows[0].target : 'unknown';

    const evidence = typeof row.evidence === 'string' ? JSON.parse(row.evidence) : row.evidence;
    const explanation = typeof row.explanation === 'string' ? JSON.parse(row.explanation) : row.explanation;

    return {
      experimentId: row.experiment_id,
      target,
      classification: row.classification as any,
      confidence: row.confidence as any,
      summary: `The test is classified as ${row.classification}.`,
      evidence: {
        explanation,
        conditionMetrics: evidence.conditionMetrics,
        totalObservations: evidence.totalObservations
      },
      limitations: row.limitations
    };
  }

  public async listExperiments(options: ListExperimentsOptions = {}): Promise<PaginatedHistory> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (options.target) {
      conditions.push(`e.target ILIKE $${paramIndex++}`);
      params.push(`%${options.target}%`);
    }

    if (options.status && options.status.length > 0) {
      const placeholders = options.status.map(() => `$${paramIndex++}`).join(', ');
      conditions.push(`e.status IN (${placeholders})`);
      params.push(...options.status);
    }

    if (options.classification && options.classification.length > 0) {
      const placeholders = options.classification.map(() => `$${paramIndex++}`).join(', ');
      conditions.push(`d.classification IN (${placeholders})`);
      params.push(...options.classification);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countSql = `
      SELECT COUNT(*) as total
      FROM experiments e
      LEFT JOIN diagnoses d ON e.id = d.experiment_id
      ${whereClause}
    `;
    const countRes = await this.client.query(countSql, params);
    const total = parseInt(countRes.rows[0].total, 10);

    // Data query
    const sql = `
      SELECT e.*, d.classification as diagnosis_classification
      FROM experiments e
      LEFT JOIN diagnoses d ON e.id = d.experiment_id
      ${whereClause}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const dataParams = [...params, limit, offset];

    const res = await this.client.query(sql, dataParams);
    const items: HistoryItem[] = res.rows.map((row: any) => {
      const item: HistoryItem = {
        experimentId: row.id,
        createdAt: new Date(row.created_at).toISOString(),
        status: row.status as any,
        config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
        summary: typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary
      };
      if (row.diagnosis_classification) {
        item.diagnosisClassification = row.diagnosis_classification;
      }
      return item;
    });

    return {
      items,
      total,
      page,
      limit
    };
  }

  public async close(): Promise<void> {
    if (this.client instanceof Pool) {
      await this.client.end();
    }
  }
}
