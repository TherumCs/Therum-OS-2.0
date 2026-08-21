import { readFileSync } from 'node:fs';
import { logger } from './logger.js';

// Node >=15 TERMINATES the process on an unhandled promise rejection by default.
// That is exactly what happened in prod: one stray dynamic import() rejected
// (an ESM module that failed to compile) with nobody awaiting it, and the whole
// API went down mid-request and PM2 churned a restart. A rejected promise does
// not corrupt global state the way a synchronous throw can, so for a web server
// the right move is to LOG it and stay up — a background side effect failing
// must never drop the process for every shopper.
//
// A genuinely uncaught SYNCHRONOUS exception is different: state may be half
// mutated, so we log and exit(1) and let the supervisor restart clean. That is
// already Node's default behaviour; we only add the log so the next one is
// attributable instead of a silent PM2 restart.
let installed = false;

export function installProcessGuards(scope: string): void {
  if (installed) return; // idempotent — safe if an entrypoint calls it twice
  installed = true;

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    // An ESM compile SyntaxError from a runtime import() does NOT carry the
    // offending module on its stack — the stack is pure Node loader frames, and
    // the file path is only ever printed as a stderr code-frame we never see.
    // When the loader trace is armed (THERUM_LOADER_TRACE_FILE, see
    // loaderTrace.ts) splice the recent synthetic-module loads in, so this one
    // line also carries the runtime-generated source that actually failed.
    let loaderTrace: string | undefined;
    const traceFile = process.env.THERUM_LOADER_TRACE_FILE;
    if (traceFile && err instanceof SyntaxError) {
      try {
        loaderTrace = readFileSync(traceFile, 'utf8').split('\n').slice(-60).join('\n');
      } catch {
        // trace unavailable — the stack still logs
      }
    }
    logger.error({ err, stack: err.stack, scope, loaderTrace }, 'unhandledRejection — kept process alive');
  });

  process.on('uncaughtException', (err) => {
    logger.error({ err, stack: err.stack, scope }, 'uncaughtException — exiting for supervisor restart');
    process.exit(1);
  });
}
