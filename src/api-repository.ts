import { IExperimentRepository } from './repository';
import { ExperimentConfig, ExperimentMetadata, Observation, ListExperimentsOptions, PaginatedHistory } from './types';
import { DiagnosisResult } from './diagnosis';

export class ApiExperimentRepository implements IExperimentRepository {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // strip trailing slash
    this.apiKey = apiKey;
  }

  private async request(path: string, options: RequestInit = {}) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {})
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers
    });

    if (!res.ok) {
      let msg = res.statusText;
      try {
        const err = await res.json();
        msg = err.error?.message || msg;
      } catch (e) {}
      throw new Error(`API Error ${res.status}: ${msg}`);
    }

    // 204 No Content won't have JSON
    if (res.status === 204) return null;
    return await res.json();
  }

  public async createExperiment(config: ExperimentConfig): Promise<ExperimentMetadata> {
    return this.request('/experiments', {
      method: 'POST',
      body: JSON.stringify(config)
    });
  }

  public async getMetadata(experimentId: string): Promise<ExperimentMetadata | null> {
    try {
      return await this.request(`/experiments/${experimentId}`);
    } catch (e: any) {
      if (e.message.includes('404')) return null;
      throw e;
    }
  }

  public async updateMetadata(experimentId: string, updates: Partial<ExperimentMetadata>): Promise<void> {
    await this.request(`/experiments/${experimentId}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  }

  public async listExperiments(options?: ListExperimentsOptions): Promise<PaginatedHistory> {
    const search = new URLSearchParams();
    if (options?.page) search.set('page', String(options.page));
    if (options?.limit) search.set('limit', String(options.limit));
    if (options?.target) search.set('target', options.target);
    if (options?.status) options.status.forEach(s => search.append('status', s));
    if (options?.classification) options.classification.forEach(c => search.append('classification', c));
    const qs = search.toString() ? `?${search.toString()}` : '';
    return this.request(`/experiments${qs}`);
  }

  public async saveObservations(experimentId: string, observations: Observation[]): Promise<void> {
    await this.request(`/experiments/${experimentId}/observations`, {
      method: 'POST',
      body: JSON.stringify(observations)
    });
  }

  public async getObservations(experimentId: string): Promise<Observation[]> {
    return this.request(`/experiments/${experimentId}/observations`);
  }

  public async getObservationTerminal(experimentId: string, observationId: string): Promise<{stdout?: string, stderr?: string, exitCode?: number | null} | null> {
    try {
      return await this.request(`/experiments/${experimentId}/observations/${observationId}/terminal`);
    } catch (e: any) {
      if (e.message.includes('404')) return null;
      throw e;
    }
  }

  public async saveDiagnosis(experimentId: string, diagnosis: DiagnosisResult): Promise<void> {
    // We don't save diagnosis from the client anymore, we tell the backend to run it itself based on the raw observations it has!
    // But wait, the IExperimentRepository interface requires this method.
    // We can implement it as a POST /diagnose which ignores the payload and asks the server to compute it.
    await this.request(`/experiments/${experimentId}/diagnose`, { method: 'POST' });
  }

  public async getDiagnosis(experimentId: string): Promise<DiagnosisResult | null> {
    try {
      return await this.request(`/experiments/${experimentId}/diagnosis`);
    } catch (e: any) {
      if (e.message.includes('404')) return null;
      throw e;
    }
  }
}
