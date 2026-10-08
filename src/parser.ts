import { TestResult } from './types';
import * as crypto from 'crypto';
import * as path from 'path';

function hashError(message: string): string {
  // Simple normalization: remove line numbers and paths if possible
  // For Phase 2, we'll just hash the raw message for simplicity, 
  // but strip obvious absolute paths.
  const normalized = message.replace(/[C-Z]:\\[^\n]+/gi, '<path>')
                            .replace(/\/[a-zA-Z0-9_\-\/]+/g, '<path>');
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 8);
}

export function parseVitestJson(rawJson: any, projectPath: string): TestResult[] {
  if (!rawJson || !Array.isArray(rawJson.testResults)) {
    return [];
  }

  const results: TestResult[] = [];

  for (const fileResult of rawJson.testResults) {
    if (fileResult.assertionResults) {
      for (const assertion of fileResult.assertionResults) {
        let errorMessage: string | undefined = undefined;
        let errorHash: string | undefined = undefined;

        if (assertion.status === 'failed' && assertion.failureMessages && assertion.failureMessages.length > 0) {
          errorMessage = assertion.failureMessages.join('\n');
          errorHash = errorMessage ? hashError(errorMessage) : undefined;
        }

        results.push({
          testFile: path.relative(projectPath, fileResult.name),
          testName: assertion.title,
          status: assertion.status,
          durationMs: assertion.duration || 0,
          errorMessage,
          errorHash
        });
      }
    }
  }

  return results;
}
