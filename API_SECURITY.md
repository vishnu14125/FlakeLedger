# API security and runner execution

The API starts test runners on the machine it runs on, so it is closed by
default.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `FLAKELEDGER_API_KEY` | unset | Bearer token (min. 16 chars) required on every route except `GET /api/v1/health`. |
| `FLAKELEDGER_HOST` | `127.0.0.1` | Interface to bind. Anything non-loopback **requires** `FLAKELEDGER_API_KEY`; the server refuses to start otherwise. |
| `FLAKELEDGER_ALLOWED_ORIGINS` | `http://localhost:5173`, `http://127.0.0.1:5173`, `:4173` | Comma-separated browser origins allowed by CORS. `*` is rejected. |
| `PORT` | `4000` | Listen port. |

Set them in the environment or a `.env` file next to where the server starts.
Never commit the key.

## Behavior

- **Key configured:** every request except `/health` needs
  `Authorization: Bearer <key>`; otherwise `401`.
- **No key configured:** only `GET`/`HEAD` are served. Creating, updating,
  executing, cancelling, posting observations and diagnosing return `403
  API_KEY_NOT_CONFIGURED`. There is no unauthenticated way to start a runner.
- **CORS is not authentication.** It only controls which web pages may read
  responses; the key is still required.
- **Host header** is checked against loopback names when bound to loopback
  (DNS-rebinding defence).
- `PUT /experiments/:id` accepts only `status` and `summary`. The `config` an
  investigation executes is immutable after creation.
- The server re-validates a stored configuration immediately before executing
  it, so records written before these rules (or edited on disk) are not trusted.
- The dashboard takes the key under **Settings** and keeps it in
  `sessionStorage` for the tab. It is not part of the build.

## Runner execution

The worker no longer uses a shell. It runs `process.execPath` with the project's
own `vitest` entry point (resolved from `projectPath`) and an argument array, in
its own process group (POSIX) or killed with `taskkill /T` (Windows), so a
timeout, cancellation or server shutdown ends the whole runner tree.

Argument contract (`argsFormat`):

- `"argv"` — each `target` / `condition.args` string is exactly one runner
  argument. Nothing is quoted or interpreted. The dashboard composer writes this.
- absent (legacy) — the record predates the contract; its strings were once
  joined and parsed by `sh`. They are split with POSIX quoting rules so
  `--testNamePattern='a b'` still means `--testNamePattern=a b`. **No shell
  expansion is performed**: unquoted `; & | < > ( ) $` and backticks are rejected
  with an error rather than evaluated; globs are passed literally.

Behavior changes from the shell-based worker:

- `vitest` must be installed for the project. The worker no longer falls back to
  `npx`, which could download and run a package.
- `FLAKELEDGER_*` variables of the orchestrator are not passed to the runner.
- A `target` beginning with `-` is passed as `./<target>` (argv format) so it
  cannot be parsed as a runner option.
- Windows no longer depends on `cmd.exe` quoting.

## Threat model

An authenticated caller chooses `projectPath`, `target`, runner flags and
environment, and can therefore make the server run code that already exists in a
project directory (for example via a Vitest config). The API key is the control;
this is not a sandbox. Treat the key like shell access to the host.
