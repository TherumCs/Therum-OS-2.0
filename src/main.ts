// The entrypoint for process supervisors (PM2, systemd).
//
// server.ts only boots when argv[1] points at itself, which is false whenever
// something wraps the process — and a wrapper is exactly what a supervisor is.
// This file has no condition: importing it starts the server. Tests import
// buildServer from server.js and are unaffected.
import { installProcessGuards } from './lib/processGuards.js';
import { main } from './server.js';

installProcessGuards('api');

// Optional ESM loader trace, armed only when THERUM_LOADER_TRACE_FILE is set.
// It records runtime-loaded synthetic modules (data: URLs and the like) so the
// recurring "unhandledRejection: Missing initializer in const declaration" —
// thrown by compileSourceTextModule for a module that exists on no disk — can
// finally be attributed. Dormant and zero-cost when the env var is unset. This
// runs after server.js's static graph has already loaded (imports are hoisted),
// which is fine: the culprit is a RUNTIME import(), and every one of those fires
// after this point.
if (process.env.THERUM_LOADER_TRACE_FILE) {
  const { registerHooks } = await import('node:module');
  const { load } = await import('./lib/loaderTrace.js');
  registerHooks({ load });
}

void main();
