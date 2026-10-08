export interface RetryPolicy {
  maxRetries: number;
}

export interface ExperimentConfig {
  experimentId: string;
  target: string;         // target test file/dir
  projectPath: string;    // cwd for the run
  runsPerCondition: number;
  conditionDefs: Record<string, Condition>;
  conditions: string[];   // e.g. ["baseline", "timezone", "order", "concurrency"]
  timeoutMs: number;
  concurrency?: number;
  failFast?: boolean;
  retryPolicy?: RetryPolicy;
}

export interface Condition {
  id: string;
  name: string;
  type?: 'concurrency' | 'order' | 'environment';
  env: Record<string, string>;
  args: string[];
}

export interface TestResult {
  testFile: string;
  testName: string;
  status: 'passed' | 'failed' | 'pending' | 'todo';
  durationMs: number;
  errorMessage?: string;
  errorHash?: string;
}

export interface Observation {
  observationId: string;
  experimentId: string;
  conditionId: string;
  runNumber: number;
  startedAt: string;
  durationMs: number;
  processStatus: 'success' | 'test_failure' | 'process_failure' | 'timeout' | 'cancelled';
  testResults: TestResult[];
  environment: {
    nodeVersion: string;
    platform: string;
    arch: string;
    timezone: string;
    args: string[];
  };
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}

export interface ExperimentMetadata {
  experimentId: string;
  createdAt: string;
  status: 'created' | 'running' | 'completed' | 'failed' | 'cancelled';
  config: ExperimentConfig;
  summary?: Record<string, { runs: number; pass: number; fail: number; process_failure: number }>;
}

export interface HistoryItem extends ExperimentMetadata {
  diagnosisClassification?: string;
}

export interface PaginatedHistory {
  items: HistoryItem[];
  total: number;
  page: number;
  limit: number;
}

export interface ListExperimentsOptions {
  page?: number;
  limit?: number;
  target?: string;
  status?: string[];
  classification?: string[];
}

export interface ExperimentRecord {
  experimentId: string;
  config: ExperimentConfig;
  observations: Observation[];
  summary: Record<string, { runs: number; pass: number; fail: number; process_failure: number }>;
}
