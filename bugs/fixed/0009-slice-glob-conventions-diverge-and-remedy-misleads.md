# Bug 0009: `matching()` and `assignedFrom()` have opposite glob conventions, and the empty-discovery remedy tells half of callers the wrong fix

**Reported:** 2026-07-24
**Found in:** v0.18.0
**Fixed in:** v0.18.1 (unreleased)
**Severity:** High — an ADR-008 violation inside the ADR-008 guard: following the stated remedy converts a working rule into a silently empty one

## Description

`slices()` has two ways to source slices, and their globs are interpreted differently:

- **`assignedFrom(def)`** — globs are matched against the **absolute** file path, so they _require_ a `**/` prefix. `'src/services/**'` matches nothing.
- **`matching(glob)`** — the slice **name** is extracted by locating the glob's base directory in the path with a literal `indexOf`, so a `**/` prefix matches nothing (the literal string `**/src/services/` never occurs in an absolute path). `'**/src/services/*'` resolves **0 slices**.

The conventions are exact opposites, and each fails in the direction the other requires. v0.18.0's new discovery non-vacuity guard then made this materially worse: it emits a **single generic remedy** for both sources —

> Slice discovery matched no files. Globs match absolute file paths, so a project-relative glob (e.g. `"src/*"`) matches nothing — use `"**/src/*"`. A slice rule that discovers nothing enforces nothing.

That advice is correct for `assignedFrom()` and **actively harmful for `matching()`**. Our primary consumer is an agent (ADR-008): it reads the remedy and applies it. Applying it to a `matching()` rule silently reduces a working rule to zero slices — which, since 0.18, then fails with the same message, inviting the same wrong fix.

## Reproduction

Against any project with files directly under `src/services/` (measured on a real codebase, `apps/api`, 56 service files):

```typescript
import { resolveByMatching } from '@nielspeter/ts-archunit' // via src/models/slice.js

resolveByMatching(p, 'src/services/*') // => 56 slices  (one per service file)
resolveByMatching(p, '**/src/services/*') // => 0 slices   ← silently empty
```

End-to-end, the second form fails the 0.18 discovery guard:

```typescript
slices(p)
  .matching('**/src/services/*') // "corrected" per the guard's advice
  .should()
  .beFreeOfCycles()
  .rule({ id: 'layer/no-service-cycles' })
  .check()
// ArchRuleError: Slice discovery matched no files ... use "**/src/*"
//   ^ the rule was CORRECT before the prefix was added
```

**Expected:** both spellings resolve the same slices; the failure message states a remedy that works for the source actually used.

**Actual:** `**/`-prefixed `matching()` globs resolve nothing, and the guard recommends exactly that prefix.

## Root cause

`src/models/slice.ts`, `resolveByMatching()`. `fullGlob` already normalizes both spellings for the picomatch test:

```typescript
const fullGlob =
  glob.startsWith('/') || glob.startsWith('**') ? glob + '*/**' : '**/' + glob + '*/**'
```

…but `baseDir` was derived from the **raw** glob and then located literally:

```typescript
const lastSlashIdx = glob.lastIndexOf('/')
const baseDir = lastSlashIdx >= 0 ? glob.slice(0, lastSlashIdx + 1) : '' // '**/src/services/'
// ...
const baseDirIdx = filePath.indexOf(baseDir) // -1 for every file
if (baseDirIdx === -1) continue // → 0 slices
```

So the glob **matched** the files, and then every one was discarded during slice-name extraction.

The message defect is separate: `SliceRuleBuilder.emptyDiscoveryViolation()` had one hardcoded remedy and no knowledge of which source had been used.

## How it was found

Adopting 0.18.0 on a large real-world codebase. The guard did its job on one rule — an ADR-011 layer-direction rule using `assignedFrom({ routes: 'src/routes/**', ... })` had been **vacuous since it was written** and never enforced anything; 0.18 correctly turned that silent pass into a failure, and the `**/` remedy was exactly right there.

The sibling rule in the same file used `matching('src/services/*')` and was **working correctly** (56 slices). Applying the guard's advice to it would have broken it. The near-miss is the bug: the same message served both.

## Affected

- `slices().matching()` with any `**/`-prefixed glob (silently 0 slices; loud failure only since 0.18).
- Every empty-discovery failure emitted by `slices()` in 0.18.0 — the remedy is right for `assignedFrom()`, wrong for `matching()`.
- Not affected: `assignedFrom()` glob semantics (unchanged), and all non-empty slice resolution (unchanged).

## Wider than first reported

The first fix attempt stripped a leading `**/` and called it done. An expert review
found that this addressed only the axis the reporter had tripped over, and that the
same `baseDir` defect had a **larger** blast radius in the opposite direction:

- `baseDir` was taken up to the **last** `/`, so any glob with a trailing or
  interior wildcard put a `*` inside it — including `matching('src/features/*/')`,
  **the form used in `README.md`, all of `docs/`, all of `examples/`, and the
  `ts-archunit init` scaffold** (14 sites). Every one resolved 0 slices, and since
  0.18 every one is a hard CI failure.
- On that path the new `matching()` message was itself a false remedy: it said
  _"check that the base directory exists"_ when the directory plainly does exist.
  Bug 0009 reproduced one level down.
- Separately, the rich formatter never printed `violation.message`, so the entire
  remedy was invisible on the default surface (`.check()` / `ts-archunit check`)
  and only reachable via `--format json` — an ADR-008 failure independent of the
  wording.
- Embedding the user's globs in the message opened a new hole: `.excluding()`
  matches against the message, and `applyFilters` did not honor `bypassFilters`
  (unlike baseline and diff-aware), so an unrelated path exclusion could silence
  the guard that reports a rule enforcing nothing.

## Resolution

1. **`src/models/slice.ts`** — one `parseMatchingGlob()`: normalize away a leading
   `**/` and a trailing `/`, and derive `baseDir` as the literal prefix up to the
   **first** wildcard. `'src/features/*'`, `'src/features/*/'`,
   `'**/src/features/*'` and `'**/src/features/*/'` are now equivalent by
   construction, which is what makes the documented form work at last.
2. **`src/builders/slice-rule-builder.ts`** — remedies derived from the actual
   globs, not just the source: unanchored `assignedFrom()` globs (named with their
   slice keys), already-anchored globs, `assignedFrom({})`, a project with 0 source
   files, and no source at all. Each branch is reachable only when its advice is
   true.
3. **`src/core/format.ts`** — a finding with no source location renders its
   message in place of the useless `:0` line, so every meta-finding's remedy is
   visible on the default surface.
4. **`src/core/execute-rule.ts`** — `applyFilters` honors `bypassFilters`; a
   meta-finding can no longer be excluded away.
5. **Docs/examples/`init`** — every `assignedFrom()` / `layers` / `folders` /
   `shared` / `src` glob anchored with `**/`; new "Glob conventions" section in
   `docs/slices.md`, a troubleshooting entry, and an explicit warning that
   `matching()`'s captured segment may be a **file** (a flat folder yields one
   slice per file).

Tests: slice-**set** equality across all four spellings in `tests/models/slice.test.ts`
(the layer where the bug lives), the per-file shape from this report, degenerate
globs staying loud, and cross-wiring assertions in
`tests/builders/slice-rule-builder.test.ts` (each remedy present on its own path,
absent on the other) plus an independent check that the anchor remedy is _true_.

## Scope actually shipped

The fix took five review rounds, and rounds 1-4 each introduced a new defect of the
same family (a red->green slice collapse, or a confidently-worded remedy that was
false on a reachable input). What shipped is the subset that is independently
verified: the single-parse glob normalization, meta-finding visibility in the
default formatter, `.excluding()` honouring `bypassFilters`, and the docs/scaffold
anchoring sweep.

Withdrawn before release, to return behind an executable-remedy design and an
opt-out: the single-slice and partially-empty discovery guards, and forcing
meta-findings to error severity. Each was correct in principle and wrong in
practice - they fired on legitimate projects with advice written for a different
input.

## Lesson

Three lessons, in increasing order of usefulness:

1. A guard that fails loudly is not automatically agent-safe. ADR-008 requires the
   failure to carry **the fix that works**; a remedy shared across paths with
   different conventions is a false remedy on one of them, and a confidently wrong
   instruction is worse for an agent than none.
2. **Fix the parse, not the symptom.** The first attempt patched the one spelling
   that had been reported. The defect was that one input was parsed twice by two
   different rules — the class of bug, not the instance, is what needed removing.
3. **A message is only a remedy if it is printed.** Verify the surface the consumer
   actually reads, not the field the object happens to carry.
