# Plan 0067 — Empty-Selector Safety (proposal 014)

**Status:** Partial — A/B/D complete on `feat/f1-filtered-subjects`; C (path-glob auto-fail) **deferred** pending a version decision.
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

### C — Path-glob auto-fail on every builder ⛔ DEFERRED

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
