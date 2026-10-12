/**
 * Resolution of the API server's network and authentication settings.
 *
 * Defaults are deliberately closed: loopback only, mutating endpoints disabled
 * until an API key is configured, and browser access limited to the dashboard's
 * own origins. Binding a non-loopback interface requires an API key.
 */

export interface ServerConfig {
  host: string;
  port: number;
  /** Absent when no key is configured; mutating routes are then disabled. */
  apiKey?: string;
  allowedOrigins: string[];
  /** Host-header allowlist (DNS-rebinding defence); set only when bound to loopback. */
  allowedHosts?: string[];
}

export const DEFAULT_HOST = '127.0.0.1';
export const MIN_API_KEY_LENGTH = 16;

/** The dashboard's Vite dev server and preview server. */
export const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const LOOPBACK_HOST_HEADERS = ['localhost', '127.0.0.1', '[::1]'];

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

export function resolveServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const rawPort = env.PORT ?? '4000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535');
  }

  const host = (env.FLAKELEDGER_HOST ?? '').trim() || DEFAULT_HOST;

  const apiKey = (env.FLAKELEDGER_API_KEY ?? '').trim() || undefined;
  if (apiKey !== undefined && apiKey.length < MIN_API_KEY_LENGTH) {
    throw new Error(`FLAKELEDGER_API_KEY must be at least ${MIN_API_KEY_LENGTH} characters`);
  }

  const loopback = isLoopbackHost(host);
  if (!loopback && apiKey === undefined) {
    throw new Error(
      `Refusing to listen on non-loopback host "${host}" without FLAKELEDGER_API_KEY. ` +
        'Set an API key, or bind to 127.0.0.1.',
    );
  }

  let allowedOrigins = DEFAULT_ALLOWED_ORIGINS;
  const rawOrigins = (env.FLAKELEDGER_ALLOWED_ORIGINS ?? '').trim();
  if (rawOrigins) {
    allowedOrigins = rawOrigins
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
      .map((o) => {
        if (o === '*') throw new Error('FLAKELEDGER_ALLOWED_ORIGINS must list explicit origins, not "*"');
        let parsed: URL;
        try {
          parsed = new URL(o);
        } catch {
          throw new Error(`FLAKELEDGER_ALLOWED_ORIGINS contains an invalid origin: ${o}`);
        }
        if (parsed.origin === 'null') {
          throw new Error(`FLAKELEDGER_ALLOWED_ORIGINS contains an invalid origin: ${o}`);
        }
        return parsed.origin;
      });
  }

  return {
    host,
    port,
    apiKey,
    allowedOrigins,
    allowedHosts: loopback ? LOOPBACK_HOST_HEADERS : undefined,
  };
}
