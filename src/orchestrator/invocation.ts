import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { ExperimentConfig } from '../types';

/**
 * Runner invocation contract.
 *
 * The worker used to build `npx vitest run <target> --reporter=json ...args` and
 * hand it to a shell (`shell: true`). That made the persisted `target` and
 * `condition.args` shell syntax: their meaning depended on the host shell, and a
 * crafted value could execute arbitrary commands. The worker now spawns the
 * Vitest entry point directly with an argument array and no shell.
 *
 * Two argument formats exist, selected by `ExperimentConfig.argsFormat`:
 *
 *  - `'argv'`  — every `condition.args` element is exactly one runner argument,
 *    passed verbatim. `target` is exactly one argument. Nothing is quoted or
 *    interpreted. This is what the dashboard composer writes.
 *
 *  - absent (legacy) — the record predates this contract. Its strings were
 *    joined with spaces and interpreted by `sh -c`, so quoting such as
 *    `--testNamePattern='applies promo code'` was stripped by the shell. To keep
 *    those records meaning what they meant, they are split into words with POSIX
 *    quoting rules (single quotes, double quotes, backslash). Shell expansion is
 *    NOT performed: unquoted shell operators, `$` and backticks are rejected
 *    rather than evaluated, and glob characters are passed literally.
 *
 * `flakeledger-dashboard/src/lib/reproduction.ts` implements the same contract
 * for the copied command; `contract/argument-contract.json` pins both.
 */

export type ArgsFormat = 'argv' | 'legacy';

export class InvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvocationError';
  }
}

const SHELL_OPERATORS = new Set([';', '&', '|', '<', '>', '(', ')', '`', '$']);

/**
 * POSIX-style word splitting without expansion. Throws InvocationError for
 * constructs that only mean something to a real shell.
 */
export function splitShellWords(input: string): string[] {
  const words: string[] = [];
  let current = '';
  let inWord = false;
  let i = 0;

  const unsupported = (what: string): never => {
    throw new InvocationError(
      `Legacy argument contains shell syntax (${what}) that is not interpreted. ` +
        'Recreate the investigation with literal arguments.',
    );
  };

  while (i < input.length) {
    const ch = input[i];

    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) throw new InvocationError('Legacy argument has an unterminated single quote.');
      current += input.slice(i + 1, end);
      inWord = true;
      i = end + 1;
      continue;
    }

    if (ch === '"') {
      i++;
      let closed = false;
      while (i < input.length) {
        const c = input[i];
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        if (c === '$' || c === '`') unsupported(`'${c}' inside double quotes`);
        if (c === '\\' && i + 1 < input.length && '$`"\\\n'.includes(input[i + 1])) {
          if (input[i + 1] !== '\n') current += input[i + 1];
          i += 2;
          continue;
        }
        current += c;
        i++;
      }
      if (!closed) throw new InvocationError('Legacy argument has an unterminated double quote.');
      inWord = true;
      continue;
    }

    if (ch === '\\') {
      if (i + 1 >= input.length) {
        current += '\\';
        inWord = true;
        i++;
        continue;
      }
      if (input[i + 1] !== '\n') {
        current += input[i + 1];
        inWord = true;
      }
      i += 2;
      continue;
    }

    if (ch === ' ' || ch === '\t') {
      if (inWord) {
        words.push(current);
        current = '';
        inWord = false;
      }
      i++;
      continue;
    }

    if (ch === '\n' || ch === '\r') unsupported('unquoted newline');
    if (SHELL_OPERATORS.has(ch)) unsupported(`unquoted '${ch}'`);

    current += ch;
    inWord = true;
    i++;
  }

  if (inWord) words.push(current);
  return words;
}

export interface ResolvedRunnerArgs {
  format: ArgsFormat;
  /** Positional test filter(s) that follow `vitest run`. */
  targetArgs: string[];
  /** Condition-specific runner flags, in persisted order. */
  conditionArgs: string[];
}

function ownCondition(config: ExperimentConfig, conditionId: string) {
  if (!Object.prototype.hasOwnProperty.call(config.conditionDefs ?? {}, conditionId)) {
    throw new InvocationError(`Condition ${conditionId} is not defined in config.conditionDefs`);
  }
  return config.conditionDefs[conditionId];
}

/** A target that starts with `-` would be parsed as a runner option. */
function protectLeadingDash(target: string): string {
  return target.startsWith('-') ? `./${target}` : target;
}

export function resolveRunnerArgs(config: ExperimentConfig, conditionId: string): ResolvedRunnerArgs {
  const condition = ownCondition(config, conditionId);
  const rawArgs = Array.isArray(condition.args) ? condition.args.map((a) => String(a)) : [];

  if (config.argsFormat === 'argv') {
    return {
      format: 'argv',
      targetArgs: [protectLeadingDash(config.target.trim())],
      conditionArgs: rawArgs,
    };
  }

  return {
    format: 'legacy',
    targetArgs: splitShellWords(config.target),
    conditionArgs: splitShellWords(rawArgs.join(' ')),
  };
}

export function conditionEnv(config: ExperimentConfig, conditionId: string): Record<string, string> {
  const condition = ownCondition(config, conditionId);
  const env: Record<string, string> = {};
  if (condition.env && typeof condition.env === 'object') {
    for (const [key, value] of Object.entries(condition.env)) {
      env[key] = String(value);
    }
  }
  return env;
}

/**
 * Locates Vitest's JavaScript entry point as the project itself would resolve
 * it, so the worker can run it with `process.execPath` and no shell. This is the
 * same binary `npx vitest` selects when vitest is a project dependency, on every
 * platform, without going through `npx.cmd` / `sh`.
 *
 * Unlike `npx`, this never downloads a package: if vitest is not installed for
 * the project, the run fails with a clear error instead.
 */
export function resolveVitestEntry(projectPath: string): string {
  const base = path.resolve(projectPath);
  const req = createRequire(path.join(base, 'noop.js'));

  let pkgPath: string | undefined;
  try {
    pkgPath = req.resolve('vitest/package.json');
  } catch {
    try {
      let dir = path.dirname(req.resolve('vitest'));
      for (;;) {
        const candidate = path.join(dir, 'package.json');
        if (fs.existsSync(candidate) && JSON.parse(fs.readFileSync(candidate, 'utf8')).name === 'vitest') {
          pkgPath = candidate;
          break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      /* fall through to the error below */
    }
  }

  if (pkgPath) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const bin: unknown = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.vitest;
    if (typeof bin === 'string') {
      const entry = path.resolve(path.dirname(pkgPath), bin);
      if (fs.existsSync(entry)) return entry;
    }
  }

  throw new InvocationError(
    `Could not resolve the vitest executable from project path "${base}". ` +
      'Install vitest as a dependency of that project (FlakeLedger does not download it).',
  );
}
