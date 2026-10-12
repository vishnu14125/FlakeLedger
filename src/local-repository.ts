import { ExperimentConfig, ExperimentMetadata, ExperimentRecord, Observation, ListExperimentsOptions, PaginatedHistory, HistoryItem } from './types';
import { DiagnosisResult } from './diagnosis';
import { IExperimentRepository } from './repository';
import * as fs from 'fs';
import * as path from 'path';

export class LocalFileExperimentRepository implements IExperimentRepository {
  private baseDir: string;

  constructor(projectPath: string = process.cwd()) {
    this.baseDir = path.join(projectPath, '.flakeledger', 'experiments');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private atomicWrite(filePath: string, data: any) {
    const tempFile = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, filePath);
  }

  private getExpDir(experimentId: string): string {
    return path.join(this.baseDir, experimentId);
  }

  private migrateLegacyIfNecessary(experimentId: string) {
    const legacyExpFile = path.join(this.baseDir, `${experimentId}.json`);
    const legacyDiagFile = path.join(this.baseDir, `${experimentId}-diagnosis.json`);
    const expDir = this.getExpDir(experimentId);

    if (fs.existsSync(legacyExpFile) && !fs.existsSync(expDir)) {
      fs.mkdirSync(expDir, { recursive: true });
      const record: ExperimentRecord = JSON.parse(fs.readFileSync(legacyExpFile, 'utf-8'));
      
      const metadata: ExperimentMetadata = {
        experimentId: record.experimentId,
        createdAt: new Date().toISOString(),
        status: 'completed',
        config: record.config,
        summary: record.summary
      };

      this.atomicWrite(path.join(expDir, 'experiment.json'), metadata);
      this.atomicWrite(path.join(expDir, 'observations.json'), record.observations);

      if (fs.existsSync(legacyDiagFile)) {
        fs.renameSync(legacyDiagFile, path.join(expDir, 'diagnosis.json'));
      }
      
      fs.unlinkSync(legacyExpFile);
    }
  }

  public async createExperiment(config: ExperimentConfig): Promise<ExperimentMetadata> {
    const expDir = this.getExpDir(config.experimentId);
    if (!fs.existsSync(expDir)) {
      fs.mkdirSync(expDir, { recursive: true });
    }

    const metadata: ExperimentMetadata = {
      experimentId: config.experimentId,
      createdAt: new Date().toISOString(),
      status: 'created',
      config
    };

    this.atomicWrite(path.join(expDir, 'experiment.json'), metadata);
    this.atomicWrite(path.join(expDir, 'observations.json'), []); 

    return metadata;
  }

  public async getMetadata(experimentId: string): Promise<ExperimentMetadata | null> {
    this.migrateLegacyIfNecessary(experimentId);
    const metaFile = path.join(this.getExpDir(experimentId), 'experiment.json');
    if (!fs.existsSync(metaFile)) return null;
    return JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
  }

  public async updateMetadata(experimentId: string, updates: Partial<ExperimentMetadata>): Promise<void> {
    const meta = await this.getMetadata(experimentId);
    if (!meta) throw new Error(`Experiment ${experimentId} not found`);
    // Lifecycle fields only: `config` is what gets executed and never changes.
    if (updates.status !== undefined) meta.status = updates.status;
    if (updates.summary !== undefined) meta.summary = updates.summary;
    this.atomicWrite(path.join(this.getExpDir(experimentId), 'experiment.json'), meta);
  }

  public async saveObservations(experimentId: string, observations: Observation[]): Promise<void> {
    this.migrateLegacyIfNecessary(experimentId);
    const obsFile = path.join(this.getExpDir(experimentId), 'observations.json');
    let existing: Observation[] = [];
    if (fs.existsSync(obsFile)) {
      existing = JSON.parse(fs.readFileSync(obsFile, 'utf-8'));
    }

    const existingIds = new Set(existing.map(o => o.observationId));
    const newObs = observations.filter(o => !existingIds.has(o.observationId));

    if (newObs.length > 0) {
      existing.push(...newObs);
      this.atomicWrite(obsFile, existing);
    }
  }

  public async getObservations(experimentId: string): Promise<Observation[]> {
    this.migrateLegacyIfNecessary(experimentId);
    const obsFile = path.join(this.getExpDir(experimentId), 'observations.json');
    if (!fs.existsSync(obsFile)) return [];
    const observations: Observation[] = JSON.parse(fs.readFileSync(obsFile, 'utf-8'));
    // Strip heavy payload fields to keep the poll lightweight
    return observations.map(({ stdout, stderr, ...rest }) => rest);
  }

  public async getObservationTerminal(experimentId: string, observationId: string): Promise<{stdout?: string, stderr?: string, exitCode?: number | null} | null> {
    this.migrateLegacyIfNecessary(experimentId);
    const obsFile = path.join(this.getExpDir(experimentId), 'observations.json');
    if (!fs.existsSync(obsFile)) return null;
    const observations: Observation[] = JSON.parse(fs.readFileSync(obsFile, 'utf-8'));
    const obs = observations.find(o => o.observationId === observationId);
    if (!obs) return null;
    return {
      stdout: obs.stdout,
      stderr: obs.stderr,
      exitCode: obs.exitCode ?? null
    };
  }

  public async saveDiagnosis(experimentId: string, diagnosis: DiagnosisResult): Promise<void> {
    this.migrateLegacyIfNecessary(experimentId);
    const diagFile = path.join(this.getExpDir(experimentId), 'diagnosis.json');
    this.atomicWrite(diagFile, diagnosis);
  }

  public async getDiagnosis(experimentId: string): Promise<DiagnosisResult | null> {
    this.migrateLegacyIfNecessary(experimentId);
    const diagFile = path.join(this.getExpDir(experimentId), 'diagnosis.json');
    if (!fs.existsSync(diagFile)) return null;
    return JSON.parse(fs.readFileSync(diagFile, 'utf-8'));
  }

  public async listExperiments(options: ListExperimentsOptions = {}): Promise<PaginatedHistory> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    
    if (!fs.existsSync(this.baseDir)) {
      return { items: [], total: 0, page, limit };
    }

    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.includes('-diagnosis')) {
        const expId = entry.name.replace('.json', '');
        this.migrateLegacyIfNecessary(expId);
      }
    }

    const updatedEntries = fs.readdirSync(this.baseDir, { withFileTypes: true });
    let items: HistoryItem[] = [];

    for (const entry of updatedEntries) {
      if (entry.isDirectory()) {
        const metaFile = path.join(this.baseDir, entry.name, 'experiment.json');
        if (fs.existsSync(metaFile)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
            const item: HistoryItem = { ...meta };
            const diagFile = path.join(this.baseDir, entry.name, 'diagnosis.json');
            if (fs.existsSync(diagFile)) {
              const diag = JSON.parse(fs.readFileSync(diagFile, 'utf-8'));
              item.diagnosisClassification = diag.classification;
            }
            items.push(item);
          } catch (e) { }
        }
      }
    }

    // Apply filters
    if (options.target) {
      const search = options.target.toLowerCase();
      items = items.filter(i => i.config?.target?.toLowerCase().includes(search));
    }
    if (options.status && options.status.length > 0) {
      items = items.filter(i => options.status!.includes(i.status));
    }
    if (options.classification && options.classification.length > 0) {
      items = items.filter(i => i.diagnosisClassification && options.classification!.includes(i.diagnosisClassification));
    }

    // Sort: createdAt DESC, id DESC
    items.sort((a, b) => {
      const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.experimentId > b.experimentId ? -1 : (a.experimentId < b.experimentId ? 1 : 0);
    });

    const total = items.length;
    const offset = (page - 1) * limit;
    items = items.slice(offset, offset + limit);

    return {
      items,
      total,
      page,
      limit
    };
  }
}
