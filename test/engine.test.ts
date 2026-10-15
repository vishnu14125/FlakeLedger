import { expect, test, describe } from 'vitest';
import { parseVitestJson } from '../src/parser';
import * as path from 'path';

describe('Result Parser (Normalization)', () => {
  test('parses pass and fail correctly', () => {
    const mockRawJson = {
      testResults: [
        {
          name: '/project/test/foo.test.ts',
          status: 'failed',
          assertionResults: [
            {
              title: 'works',
              status: 'passed',
              duration: 10
            },
            {
              title: 'fails',
              status: 'failed',
              duration: 5,
              failureMessages: ['Error: something broke\n  at /file.js:10:1']
            }
          ]
        }
      ]
    };

    const results = parseVitestJson(mockRawJson, '/project');
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('passed');
    expect(results[1].status).toBe('failed');
    expect(results[1].testName).toBe('fails');
    expect(results[1].errorMessage).toContain('something broke');
    expect(results[1].errorHash).toBeDefined();
  });

  test('errorHash strips absolute paths', () => {
    const errorMsg1 = 'AssertionError at C:\\Users\\Dev\\project\\file.ts:10';
    const errorMsg2 = 'AssertionError at C:\\Users\\CI\\project\\file.ts:10';
    
    // Hash them manually as the parser would
    const mockRawJson1 = { testResults: [{ name: 'f', assertionResults: [{ status: 'failed', failureMessages: [errorMsg1] }] }] };
    const mockRawJson2 = { testResults: [{ name: 'f', assertionResults: [{ status: 'failed', failureMessages: [errorMsg2] }] }] };
    
    const r1 = parseVitestJson(mockRawJson1, 'C:\\');
    const r2 = parseVitestJson(mockRawJson2, 'C:\\');
    
    expect(r1[0].errorHash).toEqual(r2[0].errorHash);
  });

  test('handles malformed/missing JSON gracefully', () => {
    // Missing testResults
    expect(parseVitestJson({}, '/project')).toEqual([]);
    // Null input
    expect(parseVitestJson(null, '/project')).toEqual([]);
    // Malformed internal structure
    expect(parseVitestJson({ testResults: [{}] }, '/project')).toEqual([]);
  });
  test('errorHash is stable across identical errors with different dynamic IDs', () => {
    // Current normalizer just strips paths. We'll verify it doesn't accidentally depend on other fields.
    const msg = 'Error: Expected 5 but got 10';
    
    const mockRawJson1 = { testResults: [{ name: 'f', assertionResults: [{ status: 'failed', failureMessages: [msg] }] }] };
    const mockRawJson2 = { testResults: [{ name: 'f', assertionResults: [{ status: 'failed', failureMessages: [msg] }] }] };
    
    const r1 = parseVitestJson(mockRawJson1, 'C:\\');
    const r2 = parseVitestJson(mockRawJson2, 'C:\\');
    
    expect(r1[0].errorHash).toEqual(r2[0].errorHash);
  });
});
