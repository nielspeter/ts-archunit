# ts-archunit Product Direction (AI era)

**Created:** 2026-07-24
**Companion to:** `docs/why-ts-archunit.md` (the positioning) and `plans/ROADMAP.md` (the plan log).
**Basis:** the cmless coverage audit (`../cmless` → `architecture-docs/ts-archunit-coverage-audit-2026-07.md`) + architect & product reviews of proposals 014, 015, 016, 017.

This converts the positioning into a **sequenced, review-validated roadmap**. The reviews revealed that the open proposals are not four independent features — they share unbuilt foundations and repeat one lesson (extract the shared core before the feature). That dependency structure, not the feature list, is the roadmap.

## The shape: three surfaces

ts-archunit has three possible surfaces (Böckeler's guide/sensor grid, `docs/why-ts-archunit.md`):

| Surface                                           | What it does                             | State                              | Direction             |
| ------------------------------------------------- | ---------------------------------------- | ---------------------------------- | --------------------- |
| **Sensor** (enforce)                              | fail on rules you wrote                  | mature                             | harden foundations    |
| **Discovery** (find un-ruled drift)               | duplicate/inconsistent/hotspot detection | thin — 2 advisory smells           | **the moat — invest** |
| **Guide** (feed-forward constraints to the agent) | rules as machine-readable constraints    | nascent (`explain --format agent`) | **grow**              |

The cmless audit proved the point empirically: a _power user_ of the sensor surface, using **zero** of discovery, with ~700 duplicate-body findings invisible to 177 enforced rules, and false-greens in its own gates.

## Foundations (build first — shared keystones)

These are prerequisites shared across proposals. Building the feature before the foundation ships duplication.

- **F1 — Filtered-subject materialization API on `RuleBuilder`.** Return the post-`.that()` filtered subjects (and their count). Today `getElements()` is _pre-filter_; predicate filtering happens only inside private `evaluate()` (`src/core/rule-builder.ts:340–350`), which computes `filtered.length` at :345 and discards it at :350, returning `ArchViolation[]`. **No method yields the filtered set.** This single capability unblocks **017** (`.from(selection, keyFn)`) _and_ **014** (`.expectNonEmpty()` / subject count). The keystone — design it deliberately as a general `RuleBuilder` contract.
- **F2 — Shared set-difference + non-vacuity core.** Powers **017**'s `correspondence`, and `crossLayer`'s _existence_ check re-expresses on it — fixing a shipped false-green (below). Keep `crossLayer`'s pairwise-_content_ conditions (`haveConsistentExports`, `satisfyPairCondition`) separate; only the existence check collapses in.
- **F3 — Shared call-agnostic object-literal traversal** (`forEachObjectLiteralFunctionProperty`). Powers **016**'s collection and the existing `callback-extractor` path. `extractFromObjectLiteral` (`src/helpers/callback-extractor.ts:65`) is private + call-bound (needs a `CallExpression`) — only its traversal shape is reusable, so extract the shared primitive rather than claim reuse.
- **F4 — Meta/discovery findings bypass diff-aware + baseline.** Findings about rule _config_ (empty selector, empty discovery) have no source node, so `DiffFilter.filterToChanged` and `Baseline.filterNew` drop them (`src/helpers/diff-aware.ts:28`, `src/helpers/baseline.ts:147`) — the standard CI mode re-greens the guard. Config-level guards must survive diff/baseline. Cross-cutting correctness; also the substrate for a fail-grade discovery surface.

## Fix shipped false-greens (dogfood ADR-008)

The reviews surfaced live ADR-008 violations _in shipped code_ — the exact sin the tool sells against:

- `crossLayer`'s `haveMatchingCounterpart` returns green on an empty layer (`src/conditions/cross-layer.ts:16,38–52`). → fold into **F2**.
- `restrictedPackages` is import-based (`src/presets/layered.ts:93`) and cannot see global-namespace access (`Bun.serve`, `Deno.*`) → a false-green if used to "confine a global." → note in docs; motivates the `runtimeIsolation` follow-up.
- 014's diff/baseline drop → **F4**.

## Proposals — verdicts and required changes

| #                          | Verdict                      | Depends on        | Key required changes                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ---------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **017** correspondence     | Ship the concept; resequence | F1, F2            | Name the _sides_ (`.side('routes', …)`) + set-language terminals (`.beComplete()`/`.haveNoOrphans()`); `correspondence` over `correspond`; decide family-aware; fix examples (they call non-existent APIs — `getMethodName()` not `.method()`); decouple from 014 (non-vacuity is a 2-line in-builder check); define key-collision semantics; decide the `keyFn` engine-boundary story (ADR-007).                                             |
| **014** empty-selector     | Ship Layer 1; re-cut         | F1, F4, path-norm | **Cut the line at path-glob-vs-semantic, not preset-vs-rule** (closes the agent's miss #2); land in slice resolution + a shared preset helper; make it empty-_files_-aware for `assignedFrom`; co-sequence path normalization; fix preset docs; name `.expectNonEmpty()`; Layers 2–3 are follow-ups (L3 = json/agent output only). BC: breaking change — version bump + a conscious legit-empty decision.                                     |
| **016** object-literal fns | Ship docs fix now; then flag | F3                | **Ship the `functions.md:7,19` "every function shape" → "every _named_ function shape" fix immediately, decoupled.** Widen `includeObjectLiteralArrows` → `includeObjectLiteralFunctions` (arrows + fn-expr + method shorthand, matching the idiom/machinery) or justify arrows-only; qualified default names (`routes["/x"].GET`); acceptance test by name+file:line _tuples_ not a Set; note it's the first public option on `functions()`. |
| **015** Bun tier-3         | Adopt the decision           | 016 first         | No core preset; **discoverable** docs recipe (FAQ + index + the `modules()` handler workaround for today); tier-3 `@ts-archunit/bun` gated on a _second, independently-designed_ app; fix the decomposition (import `bun:sqlite` vs global `Bun.*`; `restrictedPackages` is layered-only); file the `runtimeIsolation` follow-up.                                                                                                             |

## New threads the reviews surfaced (file as proposals)

- **Path normalization for discovery globs** — the root cause of 014's miss #1 (globs matched against absolute paths); `boundaries.ts:99–106` hand-rolls discovery without the `**/`-prepend that `resolveByMatching` already applies. Fixes `src/*` _and_ kills a duplication.
- **`runtimeIsolation` primitive** — layer-agnostic confinement of both imports _and_ globals (`Bun`/`Deno`/`process`/`Worker`); not a synonym for `restrictPackageToLayer` (import-only). The vertical-slice trigger has already fired.
- **The "relation-over-a-set" family** — consistency / correspondence / canonicity. Don't build the family; name 017's member family-aware so it slots in without a breaking rename.
- **Discovery surface → fail-grade + adoptability** — promote `duplicateBodies`/`inconsistentSiblings` toward `.check()` with agent-first messages, and add a **baseline/ratchet** so the metric/discovery rules are adoptable on a codebase that already has debt (why cmless left `maxMethods` etc. at zero usage).
- **Guide export** — rules as feed-forward machine constraints beyond `explain --format agent` (Böckeler's computational-guide cell; Shaukat's "constraints cut tokens 30%").

## Sequencing

```
F1 ─┬─▶ 017 (with F2)
    └─▶ 014 (.expectNonEmpty)      F3 ─▶ 016
F2 ─┬─▶ 017                        F4 ─▶ 014 + discovery-fail-grade
    └─▶ crossLayer existence fix
```

**P0 — no dependencies, high value, ship now:** `functions.md` docs fix (016); 015 decision + discoverable recipe; path-normalization for discovery globs.
**P1 — foundations:** F1 (keystone), F4.
**P2 — features on foundations:** F2 + crossLayer reconcile → 017; 014 Layer 1; F3 → 016 flag.
**P3 — the moat:** discovery surface to fail-grade + baseline/ratchet adoptability; guide export.

## Principle

Every item above is a _sensor/discovery/guide_ move that keeps ts-archunit the **deterministic, un-gameable, team-specific-architecture verifier** — and each foundation (F1–F4) exists because the reviews showed the alternative was to ship duplication or a false-green. Build the shared brick, then the feature. Fix our own false-greens first; we sell against them.
