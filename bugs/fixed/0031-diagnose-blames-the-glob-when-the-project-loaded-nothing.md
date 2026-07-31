# Bug 0031: `diagnose()` blames the glob when the project loaded nothing

**Reported:** 2026-07-31
**Found in:** v0.32.0 (the shipped npm package), by [plan 0074](../plans/0074-r3b-the-selector-glob-flip.md)'s gate run 4
**Status:** **FIXED** 2026-07-31, released in **v0.33.0**. Verified against the same real codebase that
found it, remedy included — see below.
**Severity:** High **once R3b ships**, Medium today. Today this is a diagnostic's advice. R3b turns
these exact strings into the text of a **failing build**, so the wrong cause becomes the thing CI
prints and an agent acts on.

## Description

When a project loads **zero source files**, every glob in every rule is dead — not because the
glob is wrong, but because there is nothing to match against. `diagnose()` reports each glob
individually with `no-match`, whose advice reads:

> these are anchored but matched no file. Common causes: the glob names a directory rather than
> the files inside it (append `"/**"`), a path segment is misspelled, or the directory holds no
> source files

All three causes are wrong for this input, and the reader is sent to edit rules that are fine.

**This project already knows the rule and states it in a comment.**
`src/builders/slice-rule-builder.ts:345`:

```ts
// Nothing can match when the project loaded no files at all — blaming the
// glob would send the caller to the wrong file entirely.
if (this.project.getSourceFiles().length === 0) {
```

The slice builder checks; `diagnose()` does not. So in one run against one project, `check` prints
the correct cause and `doctor` prints the wrong one — see the reproduction.

## Reproduction

Measured against `honojs/hono` @ `51db313` (v4.12.33), a real codebase chosen sight-unseen, using
the **published** `@nielspeter/ts-archunit@0.32.0` from npm and the rule file that
`ts-archunit init --preset layered` scaffolds, unedited.

Hono's root `tsconfig.json` is solution-style — `"files": []` plus project references — so it
loads nothing. Verified independently of ts-archunit: `tsc -p tsconfig.json --listFilesOnly` lists
**0** files under `src/`.

`ts-archunit check arch.rules.ts` — **correct**:

```
The project loaded 0 source files (…/hono/tsconfig.json), so no glob can match.
Check that this tsconfig includes your sources.
```

`ts-archunit doctor arch.rules.ts` — same project, same run, **wrong**, ×6:

```
preset/layered/layer-order
assignedFrom({ routes: "**/src/routes/**" })  [discovery]
no-match: these are anchored but matched no file. Common causes: the glob names a
directory rather than the files inside it (append "/**"), a path segment is
misspelled, or the directory holds no source files
```

The glob already ends in `/**`, the segments are spelled correctly, and whether the directory
holds source files is irrelevant — the project holds none.

Ten findings total in that run: 4 selector, 6 discovery. The 4 selector findings on `**/src/**`
get the **right** cause (`onDisk: 'holds-typescript'` → "your tsconfig include/exclude keeps it out
of the project"), which is what makes the other 6 a defect rather than a limitation: the same run
demonstrates the tool can tell.

## Fix

In `describe()` (`src/core/diagnose.ts:178`), check the project's source-file count before
consulting the glob, exactly as `slice-rule-builder.ts` does, and state that cause instead.

Two details that matter:

- **Report it once, not per glob.** Ten findings that all say "the project is empty" is one fact
  printed ten times; the per-glob identity that ADR-008 rule 4 asks for is meaningless when the
  fault is not in the globs. This may want a distinct `kind`.
- The existing wording is already verified against a real input — reuse
  `slice-rule-builder.ts`'s sentence rather than writing a second one that can drift from it.

## Guard

ADR-008's question: what would the test do if the check were reverted? A fixture project that
loads zero files, diagnosed, asserting the **cause text** — not the finding count, which is
unchanged by the bug. The control is a project that loads normally with a genuinely misspelled
glob, which must still get `no-match`'s list; without it, a fix that returns the empty-project
cause unconditionally passes.

## Related

- [Bug 0032](./0032-an-absent-path-defers-to-a-cause-list-it-refutes.md) — the other half of the
  same gate run.
- [Plan 0074](../plans/0074-r3b-the-selector-glob-flip.md) — R3b, which makes this text a build
  failure.

## Fix as shipped

`diagnose()` checks the project's source-file count before consulting any glob and emits one
`project-empty` finding, then skips the glob walk for that rule. Deduped by tsconfig **path**, so a
rule file with two `project()` calls still reports each empty one once. The message names the
mechanism, because "check that this tsconfig includes your sources" is not actionable for a config
that has no `include` at all:

> the project loaded 0 source files (…), so no glob in any rule built against it can match —
> including this one. Check that this tsconfig includes your sources; a solution-style tsconfig
> (`"files": []` with `"references"`) loads none of them, so point the rules at the tsconfig that
> does. Reported once for this project: the globs are not the fault and are left undiagnosed until
> it loads

A condition-less rule is **still** reported alongside it. The empty project must not become a
blanket excuse — that would trade one silent pass for another.

**Verified on the input that found it**, not on a fixture: hono's scaffold went from **10 findings
to 1**, and applying the stated remedy — repointing `project()` at `tsconfig.build.json` — cleared
it and surfaced the real glob findings. ADR-008 rule 2 asks that a remedy be verified to
remediate; this one was run.

## Sabotage matrix

Reverts enumerated from the diff. **7 of 7 caught** across both bugs; the four for this one:

| revert                                                 | caught |
| ------------------------------------------------------ | ------ |
| the empty-project check removed entirely               | yes    |
| right `kind`, `no-match`'s cause list as the advice    | yes    |
| the check fires for every project, not only empty ones | yes    |
| reported per rule instead of once per project          | yes    |

Row 2 first scored **MISSED**, and was not. `s.index('          advice:')` matched the
`project-unknown` block, which appears earlier in the file — so the sabotage rewrote a different
finding's advice and left this one intact. Anchoring on `kind: 'project-empty'` and asserting the
targeted text contains `loaded 0 source files` caught it. Second time in one session that a
sabotage hit the wrong target and reported the guard as absent; both times the flattering
direction. An unasserted anchor is not a revert.

## Corrections after review

Three, all measured:

1. **"Reported once for this project" was false on the primary surface.** `runDoctor` calls
   `diagnose()` **per rule file**, so two rule files against one empty tsconfig printed the
   sentence claiming it was printed once, twice. The clause is gone; it was tool bookkeeping in the
   position where the reader's next action belongs.
2. **"Point the rules at the tsconfig that does" was an impossible remedy on reachable inputs** —
   an `include` matching nothing, a repository with no `.ts` files, `"files": []` with no
   `references`. Stating it only when true meant reading the tsconfig, which put `JSON.parse` in
   `src/core/` and was **rejected by this project's own architecture rules** (`hygiene/no-json-parse`,
   "ts-archunit analyzes AST, not JSON"; `references` is not in `getCompilerOptions()`, and ADR-002
   rules out the raw TypeScript API). Exempting the rule for this file would have been the wrong
   direction. The clause is now phrased as a **condition the reader settles by glancing at their own
   file**, true either way.
3. **Dedup keyed on the tsconfig path, which is not an identity.** `workspace([...])` sets
   `tsConfigPath` to the alphabetically first of N, so a `workspace()` and a `project()` naming that
   config collided — and the loser hit the early exit and contributed **no finding at all**. A false
   green inside the fix for a false green. Now a `WeakSet` on the project object, which is what
   `pathUniverse` and `diskSet` already key on.

Two further gaps review found, both fixed: a **syntactic** fault (`'./src/**'`) was suppressed by
the early exit though no project could fix it — it is dead in every possible project, so
withholding it bought a second failing round trip; and the empty-project text was a **second copy**
of one the slice builder already owned, created while quoting this bug's own instruction not to.
They had already diverged in the wrong direction: the builder's copy — the one a **failing build**
prints — kept the wording this bug records as not actionable. Both now call
`emptyProjectAdvice()`, pinned by a parity test in `assertion-gate.test.ts` beside the
`assertionAdvice` precedent.

The fixture also changed. The first guard used an in-memory double whose emptiness came from
`useInMemoryFileSystem`; it is now `tests/fixtures/does-not-load/`, a real solution-style config
that ts-morph loads 0 files from, with a referenced project that loads 1. That buys the remedy
test: apply the fix the message states and assert the finding clears — rather than asserting it in
a commit message.

**Final matrix: 11 of 11.**
