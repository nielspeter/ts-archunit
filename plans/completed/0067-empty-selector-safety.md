# Plan 0067 — Empty-Selector Safety (proposal 014)

**Status:** **DONE.** A/B/D shipped earlier; **C completed 2026-08-01 across three releases** — see the Result below.
**Priority:** High — the product committing the false-green ADR-008 exists to forbid (observed twice on a real app).
**Depends on:** plan 0064 (F1 — `subjects()`). **Context:** `proposals/014-empty-selector-safety.md` (draft 2), `plans/ai-era-product-direction.md` (F4).

## Problem

A selector matching zero subjects passes green (`0 === 0`), mistaken for coverage — the tool producing the exact false-green it sells against. Two shapes: a mis-globbed **discovery** preset (`strictBoundaries({ folders: 'src/*' })` → zero boundaries → green) and a mis-globbed **hand-written** rule (`modules().resideInFolder('src/**')` → zero modules → green). Globs match **absolute** paths, so a project-relative glob matches nothing.

## Design & status

The fail/opt-in line is drawn at selector **kind** — path/scope glob vs semantic predicate (prod-014 C2). Landed in sub-slices:

### A — Meta-findings bypass diff/baseline (F4) ✅

`ArchViolation.bypassFilters`, honored by `DiffFilter.filterToChanged` and `Baseline.filterNew`. Config-level findings (empty selector/discovery) have no changed file to attribute to, so without this the standard CI mode (`checkAll(..., { diff })`) silently drops them and the guard re-greens (arch-014 C1, critical). Now they survive.

### B — `.expectNonEmpty()` opt-in on `RuleBuilder` ✅

Built on `subjects()` (F1): an empty selector under `.expectNonEmpty()` fails with a bypass-flagged meta-finding instead of passing vacuously. Opt-in, so legitimately-empty semantic selections (`extend('BaseRepository')` with no repos yet) stay green. Survives `.should()` forks. This is the tool for the semantic/hand-written case.

### D — Discovery non-vacuity for slices + presets ✅

`SliceRuleBuilder.collectViolations` fails when discovery resolved **no slices or slices with no files** (the `assignedFrom` empty-_files_ case, arch-014 I1) — replacing the silent `return []`, and closing a direct `slices().matching('typo')` too. `assertDiscovered()` (in `presets/shared.ts`) guards a preset's upstream bespoke discovery; wired into `strictBoundaries` (`boundaries.ts`), replacing the `if (Object.keys(sliceDef).length > 0)` skip that hid the observed miss #1. `layeredArchitecture` is covered transitively (it discovers via `slices().assignedFrom`). All discovery findings bypass diff/baseline (A).

### C — Path-glob auto-fail on every builder ✅ DONE

The full re-cut (prod-014 C2): mark `resideInFolder`/`resideInFile`/`havePathMatching` predicates with their globs; in `evaluate()`, fail (default, no opt-in) when a path glob matches **zero project files** — checked at the **file** level (element-type-independent) so a valid-but-classless folder does not false-fire. This closes the hand-written miss #2 _for the agent_ without opt-in.

Deferred because it is the one genuinely **breaking** change (every rule with a mis-globbed path predicate starts failing) and warrants a deliberate version-bump decision + suite-wide + downstream validation, not a rushed landing. `.expectNonEmpty()` (B) already gives users the explicit tool for this case in the meantime. Design is settled (above); the remaining work is the predicate marker, the file-level glob check in `evaluate()`, co-sequenced path-normalization (so `src/*` _works_ rather than just failing loudly — the root cause), and the preset-docs sweep (examples must not be copy-paste-red). File as a follow-up.

## Files changed (A/B/D)

| File                                                   | Change                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `src/core/violation.ts`                                | `bypassFilters` on `ArchViolation`.                                                                          |
| `src/helpers/diff-aware.ts`, `src/helpers/baseline.ts` | Honor `bypassFilters`.                                                                                       |
| `src/core/rule-builder.ts`                             | `_requireNonEmpty`, `.expectNonEmpty()`, `emptySelectionViolation()`, evaluate hook.                         |
| `src/builders/slice-rule-builder.ts`                   | Discovery non-vacuity guard + `emptyDiscoveryViolation()`.                                                   |
| `src/presets/shared.ts`                                | `assertDiscovered()` helper.                                                                                 |
| `src/presets/boundaries.ts`                            | Discovery guard replaces the silent skip.                                                                    |
| tests                                                  | `rule-builder`, `diff-aware`, `slice-rule-builder`, `boundaries` (the false-green test now asserts the fix). |

Full suite: **2103 passing**, typecheck + lint clean. Only one prior test changed — the boundaries test that _encoded_ the false-green.

## Out of scope

- **C** (above) — the path-glob auto-fail + path-normalization + docs sweep; needs a version decision.
- Layer 3 (subject count in `--format json` / `explain --format agent`) — minor, deferred.
- A `.allowEmpty()` escape hatch for discovery — deliberately omitted (fail-closed; prescribed structure over a stampable marker, ADR-008 Rule 3).

## Result — C, and why it took three releases rather than one

C listed four components. **Two of them shipped under other plans before C was picked up**, which is only visible by reading them off against what exists:

| Component                 | Where it landed                                                        |
| ------------------------- | ---------------------------------------------------------------------- |
| The predicate glob marker | **0069 R2a** — `Predicate.globs` / `DeclaredGlobs`                     |
| The file-level auto-fail  | **0074 R3b**, v0.34.0 — a dead selector glob fails at check time       |
| **Path normalization**    | **This**, v0.35.0                                                      |
| The preset-docs sweep     | **This**, v0.35.0 — `slices.md`, `troubleshooting.md`, `core-concepts` |

So the "one genuinely breaking change" C was deferred for turned out to be R3b's, and by the time normalization was written the breaking half had already shipped. That ordering was deliberate on 0069's part (_"R3 → path-norm → two quiet releases"_) and it is the right way round: the flip makes the mistake **loud**, and normalization then makes the commonest instance of it **unnecessary**.

### What normalization does

An unanchored path glob is matched against the path **relative to the tsconfig's directory**, in addition to the absolute path. `'src/domain/**'` means that folder at the project root — narrower than the `'**/src/domain/**'` the old advice prescribed, which also matches a `src/domain` in `vendor/` or a nested package.

The root is derived **from the element**, not threaded through the builder, because a predicate is constructed two ways that must not diverge — `.that().resideInFolder(g)` and `.that().satisfy(resideInFolder(g))`. `tests/core/glob-declaration.test.ts` exists to assert those agree.

`base` moves to `'normalized'` for those globs, so `syntacticFault` stops reporting them `unanchored`: a glob stops being called dead exactly when it starts working. `'normalized'` had been in the `GlobBase` union since R2a with no producer — this is what it was reserved for.

### One inconsistency it nearly shipped with

`'./src/domain/**'` selected **3 subjects and reported a dead selector in the same run**: the runtime normalized it and `syntacticFault` still called it `dot-segment`. Two derivations disagreeing about one glob, which under R3b is a failing build on a working rule. A `./` segment is a mistake in both readings, so it is excluded from normalization and stays failing.

### Scope boundary, measured rather than assumed

Four surfaces take a path glob. After this, three accept a relative one; `slices().assignedFrom()` does not, and the layer options discover through it. Filed as [bug 0033](../../bugs/0033-assignedFrom-does-not-accept-a-project-relative-glob.md) rather than extended into, because `matching()` normalizes by a **third** mechanism again (rewriting to an anchored form) and three mechanisms for one concept should be unified deliberately. `docs/slices.md` carries the table.

### Sabotage

**7 of 7**, after a first round that found two rows unguarded — both because normalization only ever _adds_ matches, so "selects something" assertions cannot see it going too far:

- everything normalized, including explicitly-anchored globs. Discriminated by `'*/domain/**'`, which matches nothing absolutely but does match the root-relative directory.
- `relativeToRoot` trimming the prefix wherever it occurs rather than only at the start, so a file outside the root would be relativised.
