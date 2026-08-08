# Proposal 023 — Naming Convention Cleanup Before 1.0

**Status:** Draft 1 — external naming audit (2026-08-08). **Not yet architect/product reviewed.** Evidence is export signatures read from `dist/**/*.d.ts` at **v0.58.0**, i.e. from *outside* `src/` — so every item below is an observation-plus-direction, flagged for verification against actual usage and intent before actioning. Some apparent inconsistencies may encode a real distinction (a fluent terminal that reads after `.should()` vs a `satisfy()`-condition); where I could not tell from signatures alone, I say so.
**Priority:** Medium–High — **timing, not severity.** Nothing here is a bug; every fix is a rename. But the tool is pre-1.0, and public-API renames are cheap now behind `@deprecated` aliases and permanent-cost after 1.0. This is the cheapest this will ever be — the same argument [proposal 013](./013-docs-deprecation-scan.md) makes for its sweep.
**Affects:** Public API — condition/preset exports across `rules/{errors,security,naming,code-quality,dependencies,architecture}` and the core barrel; plus `docs/` (landing framing) and `examples/archunit-inspired.test.ts` (heritage framing). **No engine change** (ADR-007 boundary intact). All changes are additive + `@deprecated` aliases, enforceable by the existing docs-deprecation scan (`plans/0063-docs-deprecation-scan.md`).
**Origin:** A naming audit done while mapping the AI-coding-agent discourse (a corpus of practitioner talks) onto ts-archunit's positioning. Two things surfaced: a set of DSL identifiers whose names fight their own signatures or the grammar, and a framing skew. This proposal records them so the question is settled once, before 1.0 makes it expensive.

> **The names *are* part of the agent-facing surface.** [ADR-008](../adr/008-agent-first-failure-surfaces.md) treats the failure surface as a product for an AI consumer. A rule an agent (or a human) reaches for by an ambiguous name, or authors with the arguments backwards, is a failure of that surface before any violation is ever reported. Naming is the first `because`.

## Non-goals

- **Not** renaming the `no*` / `must*` / `have*` / `are*` / `max*` families. The grammar (`that()` → `should()` → assert) and the **predicate/condition split** (`docs/core-concepts.md`: *"predicates narrow; conditions assert; a rule needs both"*) are a genuine strength and stay. This is a cleanup of ~6 off-pattern names, not a redesign.
- **Not** the package name / "ArchUnit-inspired" heritage question — that is larger, cross-repo, and depends on a decision outside this repo (see Part D, deferred).

---

## Part A — DSL identifiers that fight their own signature or the grammar

Ranked by confidence. Each row: current (verified signature) → the friction → a proposed direction → verify-before-acting note.

### A1 — `useInsteadOf(bad, good)`: argument order contradicts the method name (high confidence)

```
functionUseInsteadOf(bad: ExpressionMatcher, good: ExpressionMatcher): Condition<ArchFunction>
classUseInsteadOf(bad: ExpressionMatcher, good: ExpressionMatcher): Condition<ClassDeclaration>
moduleUseInsteadOf(bad: ExpressionMatcher, good: ExpressionMatcher, options?): Condition<SourceFile>
```

The name reads **"use ⟨good⟩ instead of ⟨bad⟩"** (good first). The signature is **`(bad, good)`** (bad first). Anyone authoring from the method name will pass the arguments in the wrong order, and — because both params are `ExpressionMatcher` — the type system cannot catch it. This is a silent foot-gun on the *prescriptive* conditions, which are exactly the ones worth promoting (see Part C).

- **Direction:** either rename to match the order — `preferOver(good, bad)` — or keep `useInsteadOf` with a **named-argument object**: `useInsteadOf({ use: good, insteadOf: bad })`. The object form is self-documenting and order-immune.
- **Verify:** confirm current call sites in `examples/` and docs; the deprecation alias must map argument order correctly.

### A2 — `should*`-prefixed conditions collide with the `.should()` connector (medium-high)

Exports: `shouldExtend`, `shouldImplement`, `shouldHaveMethodNamed`, `shouldNotHaveMethodMatching`.

`should` is the grammar's connective verb (`.that()…should()…`). A condition also prefixed `should` produces either `.should().satisfy(shouldExtend(…))` or a fluent `.should().shouldExtend(…)` — both read as a stutter. Worse, the `must*` family (`mustCall`, `mustMatchName`) already occupies the "required-assertion" slot, so `should*` and `must*` are two prefixes for the same idea.

- **Direction:** fold `should*` into the `must*` family — `mustExtend`, `mustImplement`, `mustHaveMethodNamed`, `mustNotHaveMethodMatching`. Removes the connector collision *and* unifies the required-assertion prefix.
- **Verify:** whether these are `satisfy()`-conditions or fluent terminals changes the exact reading, but the collision holds either way.

### A3 — `require*` vs `must*`: two prefixes for "required" (medium)

`requireJsDocOnPublicMethods()` is the lone `require*`; the required-assertion family is otherwise `must*`. One-off prefix = one more thing to guess.

- **Direction:** `mustHaveJsDocOnPublicMethods()` (join `must*`), or move it under the `have*` family as `haveJsDocOnPublicMethods()` and let `.should().satisfy(...)` supply the modality. Pick one and state it in the convention (Part B).

### A4 — bare `no*()` defaults to `Condition<ClassDeclaration>` (medium-high — verify default)

```
noSilentCatch(): Condition<ClassDeclaration>
noGenericErrors(): Condition<ClassDeclaration>
noTypeErrors(): Condition<ClassDeclaration>
```

…with separate `functionNoSilentCatch()` / `moduleNoSilentCatch()` variants (the function/module/class triplication ratified in `plans/0046-typescript-rule-function-module-variants.md`). The concern is the **default**: "silent catch" and "generic errors" are function-shaped concepts, yet the *unprefixed, most-discoverable* name resolves to **class** scope. A user typing the obvious `noSilentCatch()` on a codebase of free functions gets a rule that quietly selects the wrong subjects — an [ADR-008](../adr/008-agent-first-failure-surfaces.md)-adjacent "selected nothing, passed green" risk, the exact class [proposal 019](./019-rules-that-enforce-nothing-must-fail.md) hardens against.

- **Direction:** consider making the bare name the *scope-agnostic* one (or the function-scoped one for function concepts), with explicit `classNo*` where class scope is meant — i.e. invert which spelling is the "surprising" one. At minimum, document the default scope on each bare export.
- **Verify:** confirm the actual default-scope behaviour in `src/` and whether the empty-selector guard (proposal 019 / plan `0064`) already catches the wrong-subject case; if it does, this drops to docs-only.

### A5 — `beFreeOfCycles` vs the `no*` / `must*` families (low — likely intentional, verify)

`beFreeOfCycles(options?)` uses a `be*` prefix (shared with `beExported`, `beImported`, `beAsync`). `be*` reads naturally as a **fluent terminal after `should()`** ("should be exported"), which may be a deliberate second family distinct from `satisfy()`-conditions. If so, this is not a smell — it's an undocumented convention.

- **Direction:** if `be*` is the fluent-terminal family, **document it** (Part B) so the split is intentional-and-visible rather than incidental. If it is *not* a real distinction, `noCycles()` aligns with the `no*` family. Do not touch until the intent is confirmed.

### A6 — `mustMatchName` / `mustNotEndWith` vs `haveNameMatching` / `haveNameEndingWith` (low-medium)

The same concept (name shape) has a condition spelling (`mustMatchName`, `naming` module) and a predicate spelling (`haveNameMatching`), with *different verbs*. The predicate/condition duplication is expected; the **verb divergence** (must-match vs have-matching, end-with vs ending-with) is the friction.

- **Direction:** align the verbs across the predicate/condition boundary (`haveNameMatching` ↔ `mustHaveNameMatching`, `haveNameEndingWith` ↔ `mustNotHaveNameEndingWith`) so one root serves both sides.

---

## Part B — make the convention a rule (dogfood)

The census (exports grouped by prefix, v0.58.0) shows a real taxonomy already in use: `no*` (prohibit), `must*`/`mustNot*` (require), `have*`/`are*` (predicate), `max*` (bound), `only*`, plus the `be*` terminal family. **It is a convention that has never been written down or enforced** — which is why A2–A5 drifted.

- **Write the taxonomy** into `docs/core-concepts.md` (or a naming ADR): one prefix per role, and the `be*` terminal-vs-`satisfy()`-condition distinction if A5 confirms it.
- **Enforce it on ourselves** with a ts-archunit rule over `src/`'s public exports — the `plans/0083-eat-our-own-dogfood.md` move. A rule of the shape *"exported conditions must match the sanctioned prefix set"* makes the next A2-class drift a red build, not a v2.0 regret. This is the same instinct as `plans/0091-a-stub-marker-is-delimited-not-cased.md` (naming as an enforceable contract).

---

## Part C — framing nouns (docs/landing, not code)

Two framing observations, both zero-code:

1. **The DSL skews prohibitive.** By prefix census, `no*`/`not*`/`mustNot*` outnumber the prescriptive `must*`/`useInsteadOf`/`respectLayerOrder`. The prescriptive conditions are the higher-value, more differentiated ones (they *steer* toward the right call, not just *forbid* the wrong one). The **presets and landing page** should foreground the prescriptive shape; A1's fix matters most here because `useInsteadOf` is the flagship prescriptive condition.
2. **"architecture" undersells the differentiator.** The moat is *body analysis* — error handling, typed errors, side-effect confinement, call-inside-loop — which is broader than "architecture." The category noun pins the tool next to import-graph tools.
3. **The right vocabulary is already written, just buried.** `docs/why-ts-archunit.md` already frames the tool on Böckeler's **guide/sensor + computational/inferential** grid — the vocabulary the field actually uses. Promote it from the positioning doc to the **landing page and README**. This is amplify, not adopt.

---

## Part D — deferred (separate decision): the package name & heritage framing

Recorded so it is not lost, explicitly **out of scope for this proposal**:

- The name `ts-archunit` sits in a near-collision cluster — `ts-arch`, `ts-arch-unit`, `arch-unit-ts`, `ArchUnitTS`, `ts-archunit` — and `examples/archunit-inspired.test.ts` leads with *"mirror the 7 categories from Java ArchUnit,"* which markets the tool into the commodity "ArchUnit port" pool and away from the AI-agent-guardrail category it actually occupies.
- This is a strategic rename, cross-repo (it interacts with the `@nielspeter/eess-ts` naming), and far larger than a DSL cleanup. **It should be its own proposal / ADR**, decided together with the eess relationship — not folded in here. The only point relevant to *this* proposal: the same pre-1.0 timing logic applies, and more so.

---

## Deprecation path (rides existing machinery)

For every rename in Part A:

1. Add the new export; make the old name a thin `@deprecated` alias delegating to it (identical behaviour).
2. A1 specifically: the alias must translate argument order, and ship a test asserting old-order and new-order produce the same violations.
3. Update `docs/`, `examples/`, and presets to the new names; the `plans/0063` docs-deprecation scan then keeps them from drifting back.
4. Keep aliases through the pre-1.0 line; drop at 1.0 with a CHANGELOG breaking-change note.

## Acceptance

- Both spellings resolve; old ones carry `@deprecated`; behaviour identical (tests per rename, and the A1 order-equivalence test).
- The prefix taxonomy is documented **and** enforced by a self-check rule over `src/` exports (Part B).
- `npm run validate` green; docs-deprecation scan green; no `src/` behaviour change.

## Open questions for review

- A4/A5 hinge on actual `src/` behaviour I could not see from `dist/` — confirm default scope (A4) and the `be*` terminal-vs-condition intent (A5) before touching either.
- Is a naming-convention self-check worth a first-class rule now, or a follow-up once `0083` (dogfood) lands its harness?
- Does the argument-order fix (A1) warrant the named-object form across *all* two-matcher conditions, or only `useInsteadOf`?
