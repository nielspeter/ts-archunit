# Proposal 014 — Empty-Selector Safety

**Status:** Draft 2 — revised after architect + product review (2026-07-24)
**Priority:** High — this is the product committing the exact false-green [ADR-008](../adr/008-agent-first-failure-surfaces.md) exists to forbid, in its core execution path, against the consumer ADR-008 names (an AI agent). Not preventive: it fired **twice in one session** below.
**Affects:** slice resolution (`src/builders/slice-rule-builder.ts`, `src/models/slice.ts`); `RuleBuilder.evaluate` for path-scope predicates and the opt-in terminal (`src/core/rule-builder.ts`); the bespoke boundary-discovery loop in `src/presets/boundaries.ts` via a shared helper in `src/presets/shared.ts`; the filter pipeline so config-level findings survive diff/baseline (`src/core/check-all.ts`, `src/helpers/diff-aware.ts`, `src/helpers/baseline.ts`).
**Depends on:** F1 (filtered-subject materialization) for Layer 2's `.expectNonEmpty()` and Layer 3's count; F4 (meta-findings bypass diff/baseline) for Layer 1 to survive standard CI; path-normalization for discovery globs, co-sequenced (see Backward compatibility). See `plans/ai-era-product-direction.md`.
**Origin:** An agent (Claude) applying ts-archunit to a Bun/vertical-slice app on 2026-07-23. Two rules were written, run, and reported **green while enforcing nothing** — a selector matched zero subjects and the rule passed. Both were caught only by a manual "inject a violation, confirm it reds" probe, run out of discipline, not because the tool said anything.

> **ts-archunit enforces ADR-008 Rule 5 on its own internal guards — by review — but not on the user rules it executes.** A user selector that matches zero subjects is `0 === 0`: green, and mistaken for coverage. The tool that sells against false greens produces one whenever a selector is empty.

## Changes in draft 2

- **Re-cut the axis (product C1/C2, the central change).** The fail/opt-in line is now drawn at selector **kind** — path/scope glob vs semantic predicate — not preset-vs-rule. `resideInFolder('src/*')` matching zero files is a typo whether it lives in a preset or a hand-written rule; default-FAIL on path-scope globs closes **both** observed misses automatically, where the preset-only cut left the hand-written miss (#2) silently green. Nuance table and layer split rewritten around this.
- **Layer 1 lands in slice resolution + `RuleBuilder.evaluate` + a shared preset helper (architect I2/I4),** replacing the silent `return []` at `slice-rule-builder.ts:107` (which also closes a direct `slices(p).matching('typo')` that is silent-green today, outside any preset). `strictBoundaries` gets its own guard via `assertDiscovered(...)` in `presets/shared.ts` because its boundary set is discovered by a bespoke loop *upstream* of `slices()`.
- **Empty-*files*-aware for `assignedFrom` (architect I1).** `resolveByDefinition` returns one slice per key regardless of matches, so a mis-globbed layered preset yields N empty slices, never zero — a `length === 0` guard is false there. The guard now checks discovered **files**, not slice count.
- **Config-level findings bypass diff + baseline (architect C1 / F4).** Meta-findings have no source node; the standard CI mode (`checkAll(..., { diff })`) drops them, and a baseline regenerated while broken would stamp them green forever. A bypass flag on the violation, honored by both filters. §Acceptance now also runs under `{ diff }` and `{ baseline }`.
- **`.mustMatch()` → `.expectNonEmpty()` (product M1),** plumbed via a `_requireNonEmpty` flag in `RuleBuilder.evaluate` (`rule-builder.ts:345–350`) — the same materialization keystone as 017 (F1). `slices()` is a separate hierarchy, so slice-emptiness is Layer 1 (no opt-in); `.expectNonEmpty()` governs only semantic predicate selection. Dropped the "share the machinery with the 006 exclusion warning" aside — that warning counts exclusion *patterns*, a different quantity.
- **Backward compatibility called out (product I1/I2/I4).** Layer 1 is a breaking behaviour change; needs a version bump and a conscious legit-empty answer (no `.allowEmpty()` escape hatch). Path-normalization and the preset **docs** fix are must-ship-together blockers, not alternatives.
- **Layer 3 rescoped (architect).** Subject count is not nearly-free — `writeReport` returns early on green for terminal/github. Scoped to `--format json` + `explain --format agent` only.
- **Synthetic findings built as typed object literals (architect M3),** not via `createViolation` (which needs a `Node`), to stay ADR-005-clean (no `as`).

## Problem

Two independent rules, both plausibly written, both false-green:

1. `checkAll(strictBoundaries(p, { folders: 'src/*', shared: [...] }))` — the preset discovers boundaries by matching `folders` against `sf.getFilePath()`, which is **absolute** (`boundaries.ts:99–106`). `src/*` matches no absolute path, so `boundaryFolders = []`. Every generated rule then iterates an empty set. **Green. Zero boundaries enforced.**
2. `modules(p).that().resideInFolder('src/**').should().satisfy(moduleNoNonNullAssertions()).check()` — the `resideInFolder` predicate matches paths absolutely too; `src/**` selects zero modules; `.satisfy()` over an empty set passes. **Green. The `no-!` standard enforced on nothing.**

The correct globs are `**/src/{owners,vets,system}` and `**/src/**`. But that is not the defect. **The defect is that getting the glob wrong is silent.** The remedy an agent needs — "your selector matched nothing; you probably meant `**/src/...`" — was never stated, so the agent (correctly optimising for green, per ADR-008 §Context) moved on. A human might have squinted at a passing test and wondered why it ran in 2ms; an agent has no reason to.

**These two misses are the same mistake.** One is in a preset, one is hand-written — but both are a path glob matching zero, made by the same user, for the same reason (project-relative glob vs absolute path). That is the observation that re-cuts this proposal: the fault line is not *where* the selector lives but *what kind* of selector it is.

### The preset already knows the set can be empty — and hides it

`src/presets/boundaries.ts`:

```ts
if (Object.keys(sliceDef).length > 0) {
  builders.push(...collectRule(slices(p).assignedFrom(sliceDef).should().beFreeOfCycles(), ...))
}
// the per-boundary loops below simply do not iterate when boundaryFolders is []
```

The `> 0` guard exists so the cycle rule does not error on an empty slice map. It handles the empty case by **silently skipping** — ADR-008 Rule 1's forbidden shape, written into the preset that most needs the opposite. The author saw the empty case and chose invisibility.

### This is not preventive; the harm is the product's core promise

A rule that cannot fail is worth less than no rule (ADR-008 §Context), because it is counted as coverage. A green `strictBoundaries` reads as "boundaries enforced." Ours enforced nothing for the length of the session. The one consumer ADR-008 is written for — the agent — is precisely the one that will never notice.

## The nuance that makes this a proposal, not a one-liner

**Empty is not always a defect.** A blanket "zero subjects → fail" cries wolf, and ADR-008 warns against exactly that (a check that fails on correct input trains suppression). The discriminator is ADR-008 Rule 1's, unchanged: **is the remedy optional?** What draft 2 changes is *where that line falls* — at the selector's kind, not at preset-vs-rule:

| Selector kind | Zero means | Remedy | Correct default |
| --- | --- | --- | --- |
| **Path/scope glob** — `resideInFolder` / `resideInFile` / `havePathMatching`, `slices().matching()`, `assignedFrom()` layer/boundary globs, `strictBoundaries.folders` | The path doesn't exist as written. A path glob that resolves to zero files is a typo — **the same typo in a preset or a hand-written rule.** Never legitimately empty. | Non-optional (fix the glob) | **Fail** — default, no opt-out |
| **Semantic predicate** — `extend('BaseRepository')`, `haveNameMatching(...)`, `areAsync()`, `areExported()` | Possibly legitimate — *there are no repositories yet*, or the bad thing genuinely does not exist. | May be optional | **Green by default; opt-in `.expectNonEmpty()`** |

The cut is drawn where the *remedy-optionality* differs, exactly as ADR-008 Rule 1 requires — the draft-1 reasoning is unchanged, only sharpened onto the correct axis. A path glob has one right answer (fix the glob); a semantic selection may be a correct "nothing to check here." Cutting at preset-vs-rule (draft 1) buried miss #2, because that fix was opt-in and the agent won't add a guard it wasn't told to. Cutting at path-vs-semantic closes miss #2 for free: it is a `resideInFolder` typo, and `resideInFolder` is path-scope.

**The composite case is the reason the cut is per-predicate, not per-rule.** In `resideInFolder('**/src/**').and().extend('BaseRepository')`, empty could mean the folder is mis-globbed (fail) *or* the folder is fine and there are simply no repositories yet (green). Layer 1 resolves this by evaluating the **path-scope predicates alone**: if the path subset matches zero elements, the glob is wrong → fail; if the path subset matches files but the full conjunction (including the semantic `extend`) is empty, that is legitimately-empty → green, with `.expectNonEmpty()` available to pin it. This isolates "the glob is wrong" from "the semantic selection is empty" without a per-rule judgement call.

Note the adjacent precedent: proposal 006's stale-exclusion **warning** fires when an `.excluding()` pattern matches zero (`execute-rule.ts:59–66`) — same "matched nothing" class, handled with `console.warn` **because that case's remedy is optional** (a shared exclusion legitimately matches zero in some workspaces). The discrimination is identical; only the answer differs by remedy-optionality.

## Proposed design

Three layers, sharpest first — plus the F4 pipeline fix Layer 1 rides on.

### 1. A path-scope selector that resolves to zero fails — it does not skip

This is the load-bearing change and it spans two hierarchies and one preset:

**a. Slice resolution (`SliceRuleBuilder.collectViolations`, replacing the `return []` at `slice-rule-builder.ts:107`).** Two entry points, two shapes of "empty":

- `matching(glob)` → `resolveByMatching` returns **zero slices** on a mis-glob (`slice.ts:45–81` builds the map only from matched files). `this._slices.length === 0` catches it.
- `assignedFrom(def)` → `resolveByDefinition` returns **one slice per key regardless of matches** (`slice.ts:100–121`), so a mis-globbed layered preset yields N slices each with empty `files` — never zero slices. A `length === 0` guard is **false** here. The correct check is on discovered **files**: `this._slices.every((s) => s.files.length === 0)`.

Combine both into one guard — *no slice has any file* → emit a failing discovery finding. This also closes a direct `slices(p).matching('typo').should().beFreeOfCycles()`, silent-green today outside any preset.

> A single empty layer inside an otherwise-populated `assignedFrom` (say, a `domain` layer with no files yet) is *not* failed by this floor — that mirrors the semantic legit-empty case (a layer not yet populated). Per-slice-empty failure is a sharper, opt-in variant, deferred to keep Layer 1 free of cry-wolf.

**b. `RuleBuilder.evaluate` path-scope subset (`rule-builder.ts:345–350`).** Tag the path-scope predicate factories (`resideInFolder`, `resideInFile`, `havePathMatching`) with a `scope: 'path'` marker — an optional string-literal field on the `Predicate` interface (ADR-005-clean; no `as`). In `evaluate`, before returning `[]` for an empty `filtered`, evaluate the path-scope predicates alone; if *they* match zero elements, emit the failing finding regardless of any semantic predicate that follows. This is what closes miss #2.

**c. `strictBoundaries` bespoke discovery (`boundaries.ts:99–106`).** The boundary set is built by a hand-rolled picomatch loop *upstream* of `slices()`, so it never reaches the slice guard. Add a shared `assertDiscovered(subjects, { what, glob, remedy })` helper in `presets/shared.ts` and call it right after the loop; remove the `Object.keys(sliceDef).length > 0` skip. Shared helper, not per-preset copy-paste, so `layeredArchitecture` and future presets reuse it.

The finding, in all three sites, is an **error-severity** synthetic violation with a stated remedy:

```
[ts-archunit] preset/boundaries: folders glob 'src/*' matched 0 directories.
  Boundary discovery matches absolute file paths — a project-relative glob
  matches nothing. Use '**/src/*' (or the absolute project path).
  A preset that discovers no subjects enforces nothing.
```

Zero false positives: a path glob with no matches is always misconfigured.

### 2. An opt-in non-empty assertion for semantic selection

For the semantic-predicate case, add a composable terminal-side guard so a user can pin a selector they know must match — leaving legitimately-empty rules green by default (ADR-006: a primitive, not a policy baked into every rule):

```ts
modules(p).that().resideInFolder('**/src/**')
  .and().satisfy(extend('BaseRepository'))
  .expectNonEmpty()       // fails if the filtered subject set is empty
  .should().satisfy(moduleNoNonNullAssertions())
  .check()
```

`.expectNonEmpty()` reds with: *"selector matched 0 modules; expected at least one. If an empty match is valid here, drop `.expectNonEmpty()`."* It is plumbed as a `_requireNonEmpty` flag checked in `RuleBuilder.evaluate` at the exact point `filtered.length === 0` is tested (`rule-builder.ts:350`) — the same filtered-subject materialization keystone as 017, so **this layer depends on F1**. `slices()` is a separate hierarchy (`TerminalBuilder`, not `RuleBuilder`); slice-emptiness is Layer 1, not something `.expectNonEmpty()` reaches.

This is opt-in on purpose. Making non-empty the *default* for a bare `.check()` over a semantic predicate would false-red the `extend('BaseRepository')`-with-no-repos case and every "assert the bad thing does not exist yet" rule — the cry-wolf ADR-008 forbids.

**Naming.** `.expectNonEmpty()` over the draft-1 `.mustMatch()` (which is ambiguous and collides with `.should()`'s "must"). `.mustExist()` is a candidate too, mirroring the existing `notExist()` condition — decide at implementation.

### 3. Subject count in machine-readable output

The `--format json` payload and `explain --format agent` state the subject count (`"subjects": 0` / `"subjects": 17`). This is **not nearly-free**, contrary to draft 1: `writeReport` returns early on a green run for the terminal and github formats (`execute-rule.ts:135`), so there is no green-path output to thread a count into for humans. It is only cheap where output always exists — json (always emits one document) and the agent-explain surface. Scope it there. Visibility is not enforcement (an agent may not read a passing report), which is why it is Layer 3, not the fix — its value is human review of the diff and the guide surface, not the agent's green path.

### F4. Config-level findings must survive diff + baseline

The synthetic findings of Layer 1 describe rule **config**, not source. They have no meaningful source node, so:

- `DiffFilter.filterToChanged` (`diff-aware.ts:25–29`) keeps only violations whose `file` is in the git-diff changed set. A config finding's `file` is not a changed source file, so **the standard CI mode `checkAll(..., { diff })` drops it** — Rule 5 would hold only in the mode nobody runs.
- `Baseline.filterNew` (`baseline.ts:147`) suppresses any violation whose hash is recorded. A baseline regenerated while the config is broken would stamp the finding **green forever** — and a broken config is never "accepted debt" to ratchet.

Add a `bypassFilters: true` flag on the synthetic `ArchViolation`; have both `DiffFilter.filterToChanged` and `Baseline.filterNew` (and their `check-all.ts` / `execute-rule.ts` callers) unconditionally retain flagged findings. This is **F4** in the direction doc — cross-cutting correctness, and the substrate for a future fail-grade discovery surface.

### Implementation note (ADR-005)

`createViolation` (`violation.ts:155`) requires a `Node`; a config-level finding has none. Build the synthetic violation as a typed `ArchViolation` object literal (`bypassFilters`, `severity: 'error'`, `element`/`file` = the glob/preset id, `line: 0`, a `message` carrying the remedy). No `createViolation`, no `as`.

## Why not "empty always fails"

Because `classes().that().satisfy(extend('BaseRepository')).should()...` matching zero is a correct green when the project has no repositories yet, and "assert no God class exists" over a class-free module is correctly satisfied, not vacuous. A default-fail on *semantic* emptiness turns both red and teaches the user to reach for `.excluding()` or delete the rule — ADR-008 Rule 3's corollary: an escape hatch stamped to go green is worse than the original gap. The path-scope case has no such legitimate-empty reading, which is why it — and only it — flips to default-fail.

## Why not warning-only (the whole thing)

ADR-008 Rule 1: an agent does not read warnings. Layer 1's remedy (fix the glob) is non-optional, so a warning is invisible to the consumer that hit it — which is the whole failure mode. Proposal 006 warns because *its* case is remedy-optional; this case, in path-scope discovery, is not. Same principle, opposite answer, for the reason ADR-008 gives.

## Backward compatibility & rollout

**Layer 1 is a breaking behaviour change.** Any project relying on the current silent-skip — a `strictBoundaries` with a mis-globbed `folders`, a `slices().matching()` that quietly finds nothing — goes from green to red on upgrade. This is the *intended* correction (those rules enforce nothing), but it must be shipped consciously:

- **Version bump + changelog.** Semver-minor is not enough for "rules that passed now fail"; treat it as a breaking release with a CHANGELOG entry naming the new failure and its fix.
- **A conscious legit-empty answer — and no escape hatch.** The one real ambiguity is a monorepo with shared config where a package legitimately has no boundaries. The answer is **not** an `.allowEmpty()` opt-out: that is precisely the green-stamp ADR-008 Rule 3 warns against (a switch whose only purpose is to make a red go green). The answer is a prescribed structure — don't apply `strictBoundaries` to a package that has none; compose presets per-package — documented as the migration path. Ship the docs answer with the behaviour change.

**Co-sequenced blockers (must ship together, not alternatives):**

- **Path normalization for discovery globs.** The root cause of miss #1 is that `boundaries.ts:99–106` hand-rolls discovery against **absolute** paths *without* the `**/`-prepend that `resolveByMatching` already applies (`slice.ts:49–50`). Normalizing discovery so `src/*` resolves as everyone expects removes the footgun's *cause*; Layer 1 surfaces its *effect*. Shipping Layer 1 without normalization means every corrected glob still needs the `**/` incantation — we would fail the user for a tool footgun. File and land normalization in the same release (it is also P0 in the direction doc, and kills the boundaries/slice discovery duplication).
- **Preset docs.** Every preset example uses project-relative globs (`src/features/*`) that only "work" where absolute and relative coincide or never assert non-vacuity. With Layer 1 live, those examples become copy-paste red. Fixing `presets.md` / the preset JSDoc to the correct idiom is a ship-blocker, not a companion — an agent copies the example verbatim.

## Acceptance test — Rule 5 applied to this proposal

A test that a zero-match config "does not throw" is itself a check that cannot fail. The acceptance test must inject the empty case and assert it **reds**, guarded by a *differently-derived* value (ADR-008 Rule 5), not a count:

- **Path-glob discovery-empty → fails:** `strictBoundaries(p, { folders: 'src/nonexistent-*' })` produces an error-severity finding. Assert the finding **set** (id + the glob it names), not that an exception occurred — an unrelated throw would pass a bare `expect(...).toThrow()`.
- **`assignedFrom` empty-*files* → fails (the architect-I1 case):** a layered preset whose layer globs all mis-resolve yields N non-empty *slices* with empty *files*; assert it still reds. A `slices.length === 0` oracle would wrongly pass here — the test must prove the guard is files-aware, not slice-count-aware.
- **`matching('typo')` direct → fails:** the bare `slices(p).matching('typo').should().beFreeOfCycles()`, outside any preset, reds.
- **Discovery-nonempty → discovers the right set (the independent derivation):** `folders: '**/src/*'` on a fixture with a known N directories discovers exactly those N — by **identity** (the set of directory basenames), not `length === N`. This is the second, differently-derived value: the glob-matcher's output vs the fixture's actual directory listing. Without it, the empty-case test certifies cardinality only and a discovery that finds the *wrong* single directory passes.
- **`.expectNonEmpty()` bites both ways:** a semantic selector known to match zero on the fixture reds; the same selector known to match reds only if the *thing being asserted* is violated, not on emptiness. Both directions, or the guard is one-sided.
- **Survives the filter pipeline (F4):** every "→ fails" case above **must also be asserted under `check(..., { diff: diffAware() })` and `{ baseline }`** (and `checkAll(..., { diff })`). Without this, Rule 5 holds only in the raw mode; the flag-honoring path is where the standard CI failure actually has to fire.
- **Vacuity guard on the guard:** assert the fixture is non-degenerate first — it *has* `src/` directories — so the "empty" result is the glob's doing, not an empty project. `0 === 0` must not be reachable.

## Prior art / relationship

- **Proposal 006 (silent exclusions)** — the stale-exclusion **warning** in `execute-rule.ts:59–66` is the remedy-*optional* sibling of this case: same "matched zero" class, opposite answer by remedy-optionality. Note it counts unused exclusion **patterns** (patterns vs violations), which is a *different* quantity from subjects-vs-elements — there is **no shared machinery** to reuse, and draft 1's "share the machinery" aside is dropped.
- **ADR-008 Rule 1 & Rule 5 corollary** — the governing decision. This proposal is the product-side instance of *"every guard needs its own vacuity guard,"* which ADR-008 currently enforces only on ts-archunit's internal guards, by review.
- **F1 (filtered-subject materialization)** — Layer 2's `.expectNonEmpty()` and Layer 3's count both read the post-`.that()` filtered set; F1 is the keystone that exposes it. Layer 1's path-scope and slice checks are internal to `evaluate`/`collectViolations` and do not need the public F1 API.
- **F4 (meta-findings bypass diff/baseline)** — the pipeline change Layer 1 rides on; without it Layer 1 is green in standard CI.
- **ADR-003 (`.warn()` terminal)** — Layer 3's report count and Layer 2's `.expectNonEmpty()` compose with, and do not replace, `.warn()`.
- **ADR-006 (framework-rules architecture)** — Layer 2 is a primitive the user opts into, not policy the core imposes; Layer 1 is a correctness property of the executor, not a policy.

## Honest sizing

- **Layer 1** is the load-bearing change and is medium, not small: the slice guard is ~10 lines, the `assertDiscovered` helper ~15, but the `RuleBuilder` path-scope check needs the `scope` marker threaded through the three path-glob predicate factories and the `evaluate` split. Still bounded, no new subsystem.
- **F4** is small and mechanical (a flag, honored in two filters and their callers) but must land *with* Layer 1 or Layer 1 is a no-op in CI.
- **Layer 2** is a new terminal plus its `_requireNonEmpty` wiring — gated on F1.
- **Layer 3** is threading the count into json + agent output only.
- Path-normalization and the docs fix are co-blockers (see Backward compatibility), sized in their own threads.
- **Ship Layer 1 + F4 + path-norm + docs together if scope must be cut.** That closes both observed misses at zero false-positive cost and is the part that maps 1:1 onto ADR-008. Layers 2–3 are the completion, not the fix.

## Alternatives considered

- **Fix the docs, not the tool.** Insufficient alone — but the docs fix is now a *co-requirement* of Layer 1, not an alternative (see Backward compatibility). Teaching `**/src/*` in docs helps humans and does nothing for the agent that copies `src/*` and gets a green; with Layer 1 the agent gets a red *and* a corrected example.
- **Normalise discovery to project-relative paths so `src/*` works.** Also promoted from "alternative" to *co-blocker*: it removes the footgun's cause, Layer 1 surfaces the residual (`src/typo-*` still matches zero and must still fail loudly). They are orthogonal and both ship.
- **Make it a ts-archunit rule and dogfood it.** Rejected for the reason ADR-008 §Enforcement gives: the check is a property of the executor, not of user source; a rule asserting "no rule matched zero" would itself need a Rule 5 guard and could not run inside the run it guards.
