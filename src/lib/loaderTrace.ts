import { appendFileSync } from 'node:fs';
import type { LoadHookSync } from 'node:module';

// Synchronous ESM/CJS load hook, registered from main.ts via
// module.registerHooks() ONLY when THERUM_LOADER_TRACE_FILE is set. It exists to
// attribute one specific production ghost:
//
//   unhandledRejection: SyntaxError: Missing initializer in const declaration
//       at compileSourceTextModule (node:internal/modules/esm/utils)
//       at ModuleLoader.moduleStrategy ... syncLink ... link
//
// That error is thrown while COMPILING the source text of a module pulled in by
// a runtime import(). Its stack names only Node's own ESM loader — never the
// module — and Node prints the offending path only as a stderr code-frame that
// pino never captures. A full V8 parse (`node --check`) of every .js/.mjs in
// dist and node_modules found NO module with this defect, which means the source
// is not a file at all: it is generated at runtime (a data: URL or other
// synthetic module). A loader hook is the only place that sees those.
//
// So we record every module load that is NOT a plain on-disk file (file:) and
// NOT a builtin (node:) — the synthetic class that can carry runtime-generated
// source — together with that source. The next occurrence lands the generated
// code that failed to compile in the trace file, and the unhandledRejection
// guard splices the tail of that file into its log line.
//
// registerHooks (Node >= 22.15 / 23.5; the box runs 24) runs the hook
// synchronously in-thread — no worker, no cross-thread port, and not deprecated
// the way the older module.register() is.
const FILE = process.env.THERUM_LOADER_TRACE_FILE ?? '';

export const load: LoadHookSync = (url, context, nextLoad) => {
  const result = nextLoad(url, context);
  if (FILE && !url.startsWith('file:') && !url.startsWith('node:')) {
    try {
      const src = result.source == null ? '' : String(result.source);
      appendFileSync(
        FILE,
        `${new Date().toISOString()} LOAD format=${result.format} url=${url.slice(0, 200)} len=${src.length}\n`
          + `----8<----\n${src.slice(0, 4000)}\n----8<----\n`,
      );
    } catch {
      // A diagnostic must NEVER break module loading. Swallow everything.
    }
  }
  return result;
};
