// Syntax gate for the storefront's browser JS.
//
// The interactive runtimes (checkout, buy box, wallets, account, cart…) ship
// as JavaScript inside backtick template-literal STRINGS in src/site/*.ts. tsc
// type-checks the .ts file but NEVER looks inside those strings, so a stray
// bracket or a bad `\'` escape compiles clean and only explodes in the
// customer's browser — this exact class has broken the money path more than
// once. This gate extracts every shipped runtime string from dist and runs
// `node --check` on it, so a syntax error fails the build instead of the sale.
//
// Run after `npm run build`. Exit non-zero on any failure.
import { createRequire } from 'node:module';
import { readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const distSite = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'site');
const tmp = mkdtempSync(join(tmpdir(), 'rtcheck-'));

// A runtime string is an exported constant whose name marks it as shipped JS.
const NAME_RE = /(RUNTIME|SCRIPT|_JS)$/;

let checked = 0;
const failures = [];

for (const file of readdirSync(distSite).filter((f) => f.endsWith('.js'))) {
  let mod;
  try {
    mod = require(join(distSite, file));
  } catch (err) {
    // A module that can't even load is its own failure worth surfacing.
    failures.push(`${file}: could not import — ${err.message}`);
    continue;
  }
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value !== 'string' || !NAME_RE.test(name)) continue;
    const out = join(tmp, `${file}.${name}.js`);
    writeFileSync(out, value);
    try {
      execFileSync(process.execPath, ['--check', out], { stdio: 'pipe' });
      checked += 1;
    } catch (err) {
      const detail = (err.stderr?.toString() || err.message).split('\n').slice(0, 3).join(' ');
      failures.push(`${file} → ${name}: ${detail}`);
    }
  }
}

if (failures.length) {
  console.error(`runtime-check: ${failures.length} FAILED, ${checked} passed`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`runtime-check: ${checked}/${checked} runtime strings pass node --check`);
