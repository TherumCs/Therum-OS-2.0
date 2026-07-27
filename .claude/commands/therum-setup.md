---
description: Scaffold this project's .claude folder (Bam's _core/addons kit shape) loaded with the Therum OS 2.0 build context
---

Set up the `.claude/` folder for this project in Bam's kit structure (`_core/` +
`addons/`), filled with the Therum OS 2.0 build context. Idempotent: never
overwrite a file that already exists — skip it and say so.

Create this tree (relative to the project root's `.claude/`):

```
.claude/
  _core/
    claude.md          ← core project rules
    autonomy.md        ← act-don't-ask rules
    operator.md        ← who Bam is / how he works
    memory.md          ← memory + state protocol
    loop.md            ← the verify loop
    skill-template.md  ← template for new addon skills
  addons/
    _template/README.md
    base/README.md
```

Then write (or update, if missing) a root `CLAUDE.md` in the project that
`@`-includes each `_core/*.md` file.

## File contents

**_core/claude.md** — condense from these sources (read them, don't guess):
- `docs/SIDEMONEY-KICKOFF.md` (state of 2.0, build order, where everything lives)
- The standing rules: NO CHECKS EVER in any checkout; WooPayments→Square is
  Bam's payout setup (never "Whop"); never build Update schemas via
  `.partial()`; every counter/limit is an atomic conditional UPDATE, never
  check-then-write; hostile-audit any new money path; literal port over
  reinterpretation — check the 1.x source and `Therum OS/previews/` before
  designing any surface; sync repo+memory to Drive after every milestone.

**_core/autonomy.md**: Bam gives direction by voice, often mid-task — act on
explicit action verbs immediately, one ask = one change, no scope creep, flag
extras separately. Confirm only destructive/irreversible ops. Never claim done
without proof (test output, screenshot, re-read). "Untested" is an acceptable
answer; false success is not.

**_core/operator.md**: Bam (we@therum.studio). Voice-to-text user — expect
garbled product names (confirm spellings that matter: "Woopayments not whop"
happened). Wants 1:1 ports of his 1.x designs, then better. Reviews visually —
show screenshots. Rates work honestly — he asks "alpha or beta?" and wants the
real answer. Password manager for creds; never type his passwords.

**_core/memory.md**: persistent memory lives at
`~/.claude/projects/-Users-bam-Local-Sites-therum-os/memory/` (read MEMORY.md
first, every session), mirrored to Drive `.claude-memory/`. CHANGELOG.md +
PROGRESS.md in-repo are the cross-machine state files. Update both + rsync to
Drive ("My Drive/Therum Projects/Therum OS/") after every milestone.

**_core/loop.md**: the delivery loop — build → typecheck (`npx tsc --noEmit`,
both apps) → rebuild dist (`npx tsc -p tsconfig.json`) → targeted tests → full
regression (`node --env-file=.env --test --test-concurrency=1 test/*.test.mjs`,
must exit 0) → re-seed the dev mock connection (suites clean it up) → live
browser verify with screenshots → CHANGELOG entry → Drive sync. No step
skipped, no "should work."

**_core/skill-template.md**: frontmatter (name, description, when-to-use) +
sections: Purpose / Inputs / Steps / Verify / Rollback. Addons copy this.

**addons/_template/README.md**: how to make an addon — copy skill-template.md,
one addon = one capability, name the folder after it.

**addons/base/README.md**: index of the base setup this project ships with —
point at docs/SIDEMONEY-KICKOFF.md, docs/PREVIEW-GAP-REPORT.md,
docs/FUTURE-BUILDOUT.md, docs/superpowers/specs/ (all design docs), and
CHANGELOG.md's 2.0.0-beta.1 banner.

## After scaffolding
1. List every file created vs skipped.
2. Read back `_core/claude.md` and confirm the standing rules made it in.
3. Remind the operator: run `/memory` to confirm CLAUDE.md loads, and copy
   `.claude/` into any new project folder (e.g. the Sidemoney build) to carry
   the kit.

$ARGUMENTS
