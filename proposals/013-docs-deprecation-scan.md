# Proposal 013 — Docs Deprecation Scan

**Status:** Open — proposed (**draft 2**; draft 1 proposed a compile harness and was
reworked after architect + product review — see "Draft history")
**Priority:** Medium-high — there is live rot in the recipe gallery today
**Affects:** `tests/` only — no `src/`, no public API, no new dependency. Uses ts-morph (ADR-002) + vitest (ADR-001).
**Origin:** ts-archunit's own docs. A manual sweep on 2026-07-17 found 18 usages of
deprecated builder methods across four doc pages — including the reference tables in
`core-concepts.md` and `classes.md`, which presented them as the canonical API. They were
found by accident while writing an unrelated page.

> **The sweep was itself incomplete — and that is the strongest argument in this document.**
> It checked a **hand-written list** of class-builder method names and never enumerated the
> module/type builders, so **9 further usages survived it** — `notImportFromCondition` in
> `what-to-check.md`, `modules.md:49` (a reference-table row), `slices.md`, `cli.md` —
> found only during review and fixed in `5ff08d0`. A hand-maintained list checking for drift
> is itself **a check that cannot fail**. Real scope: **7 pages, not 4.**
>
> This is why the scan must source its symbol list **from `src/`**, never from a list a human
> maintains.

## Problem

**The docs rot and nothing catches it.** 307 ```typescript blocks across 31 doc pages are
never compiled, and no gate reads doc prose at all. `npm run validate` (typecheck + lint +
format + test) does not see any of it, because it lives in markdown.

Three facts make this systemic rather than a one-off:

1. **Nothing checks docs at all.** No extractor, no compile pass, no lint pass over markdown.
2. **A compile check alone would not catch this class of bug.** `shouldResideInFile` compiles
   perfectly — it is **deprecated, not removed**. Deprecation is invisible to `tsc`.
3. **Nothing else flags deprecation either.** `@typescript-eslint/no-deprecated` is not
   enabled in `eslint.config.ts`, and eslint does not lint markdown regardless.

So a doc page can teach deprecated API indefinitely while every gate stays green.

### Evidence

27 known usages across 7 pages — 18 from the original sweep, 9 the sweep missed:

| Page               | Usages | Notes                                                                |
| ------------------ | ------ | -------------------------------------------------------------------- |
| `what-to-check.md` | 10     | The recipe gallery — the page users copy from                        |
| `classes.md`       | 6      | Including reference-table rows                                       |
| `modules.md`       | 5      | **`:49` is a table row** presenting the deprecated name as canonical |
| `core-concepts.md` | 3      | **Conditions table** — presented as canonical API                    |
| `functions.md`     | 1      | Reference-table row                                                  |
| `slices.md`        | 1      |                                                                      |
| `cli.md`           | 1      |                                                                      |

Drift vectors are ongoing, not historical: plan 0062 renamed preset APIs, the 0061
restructure moved pages wholesale, and 8 builder methods carry `@deprecated` tags pointing
at replacements the docs did not adopt.

### Why this matters here specifically

A credibility problem, not a chore. The product's premise is _"encode the rule so CI catches
the drift on the PR that introduces it."_ Our own docs drifted, uncaught, across releases —
and the manual remediation **missed a third of it**. The fix should be the thing we sell.

Honest sizing of user harm: deprecated ≠ broken. A reader copying `shouldResideInFile` gets a
**working** rule. The harm is (a) IDE strikethrough on code copied from official docs, which
reads as "unmaintained"; (b) teams running `@typescript-eslint/no-deprecated` get lint
failures sourced from our docs — pointed, for a lint-adjacent tool; (c) silent debt that
bites at 1.0 removal, for people who followed the docs correctly.

## Proposed design

**A deprecation scan over all markdown text.** ~60 lines, ~1s, no new dependency.

1. **Source the symbol list from `src/`** via ts-morph at test time — walk every builder,
   collect methods carrying an `@deprecated` JSDoc tag, and capture the tag's replacement
   text. The list **cannot drift**, and no human maintains it. _(This is the whole point —
   see the Origin note.)_
2. **Scan every `docs/*.md` as text**, not as fenced code — the rot lives in reference tables
   as much as in snippets.
3. **Disambiguate by dot-prefix.** `.shouldExtend(…)` is rot; bare `shouldExtend` is the real
   standalone export that `api-reference.md:194` correctly documents.
4. **Report with the replacement text** the tag already carries:

```
docs/what-to-check.md:178 — `shouldResideInFile` is deprecated:
  Use `resideInFile()` after `.should()` instead.
```

### Why text, not fences

Fence extraction **structurally cannot see the worst rot**. The headline evidence — reference
tables presenting deprecated methods as canonical — is **markdown table rows**, not
```typescript blocks. `modules.md:49` is exactly that. A fence-based design catches zero of
them.

Measured in review: replayed against pre-sweep docs, a text scan found **22 hits vs the
sweep's 18**, table rows included, in ~1s.

### What this design avoids

No preamble, no scope-awareness, no `declare const p`, no skip directive, no skip budget, no
author friction — it cannot fail a snippet for being incomplete, because it never parses one.

### Acceptance test

`git show HEAD~3:docs/` is a real regression corpus: 8 rotted usages, all recoverable. A scan
that catches 8/8 there is proven. Add a fixture asserting no false positive on the bare
`shouldExtend` export.

## Scope

- **In:** `docs/*.md`. `README.md` is free to include — the scan is text-based.
- **Out:** `ts-archunit-spec.md` — it intentionally describes unbuilt API and would emit
  permanent noise.
- Runs in `npm test`. ~1s needs no separate `test:docs` entry point.

## Alternatives considered

- **`eslint-plugin-markdown` + `@typescript-eslint/no-deprecated`.** Rejected: snippets are
  fragments (224 of 307 use `p` without defining it), so they do not parse as standalone
  modules under a type-aware lint pass without a preamble engine. And it would still only see
  fenced code — missing the table rows.
- **Keep sweeping by hand.** **Demonstrably fails** — see the Origin note. It missed 9 of 27.
- **Compile harness first** — draft 1's design. Deferred; see below.
- **Fix the `shouldExtend` naming collision instead.** Orthogonal. It reduces human confusion
  but detects nothing; review proved the machine disambiguates cleanly either way.

## Deferred — the compile harness (draft 1's proposal)

Not rejected, but **evidence-gated and separate**. Re-propose after a release cycle if the
evidence appears.

- **It defends a drift class with zero observed instances.** All 27 known usages were
  deprecations; not one was removed or renamed API.
- **Realistic effort is 3–4 days, not 1.5–2.** The ~13 `TS2339`/`TS2345`/`TS2554` failures
  each need a human deciding doc-vs-code, and the honest count can grow.
- **Its unique asset is audit value, not regression value.** Run the throwaway spike once,
  triage the ~13, discard it. Do not conflate "found bugs once" with "must run forever."
- **If built:** use **batched** `getSuggestionDiagnostics()` (one call per file,
  `code=6385 reportsDeprecated=true`), not a `forEachDescendant` + `getSymbol` walk — the
  latter is precisely the chatty per-node pattern ADR-007 identifies as fatal for TypeScript 7. Batched detection, per-hit enrichment.
- **Assembly was over-designed:** `noUnusedLocals` is **off**, so unused preamble imports are
  not errors. Union all entry-point exports (336 unique names; 28 dual-reachable, all root
  re-exports → "root wins" is collision-free) and omit only names the block itself binds.
  ~20 lines, and it fixes the `project` conflict by construction.

Spike data retained for whoever picks it up: 215/307 blocks compile naively, 224/307 with
import-stripping, ~11s for all 307 in one in-memory project. **The largest failure bucket
looked like doc bugs and was not** — `agentGuardrails`, `noAnyProperties`, `noTypeAssertions`,
`mustMatchName` are real exports from sub-entry-points (`/presets`, `/rules/*`) that a
root-only preamble cannot supply. Acting on naive output would have "fixed" correct
documentation into incorrect documentation. **The honest failure count does not exist until
the harness is scope-aware.**

## Layering (settled)

**A bespoke vitest test — do not dogfood this one.** ts-archunit's rules operate over a loaded
TypeScript project; docs are markdown needing extraction before any project exists. Forcing it
through the public DSL means teaching the DSL about markdown — serving exactly one user (us)
and violating the lego-bricks principle. A CLI command is worse: it ships internal tooling as
public surface. Keep it in `tests/`.

## Draft history

**Draft 1 (2026-07-17)** proposed a compile harness with the deprecation check as its Phase 3.
Architect + product review rejected the shape for three reasons:

1. **Fence extraction cannot see table rows** — the class of rot the proposal led with.
2. **Deprecation does not need the harness at all.** It is standalone, ~2h, and delivers
   nearly all the value. Building it on fences made it structurally unable to catch half its
   own motivating evidence.
3. **The harness defends an unobserved drift class** at 3–4 days, ahead of decided
   user-facing work (0047).

Both of draft 1's open questions were **resolved by review, not deferred**:

- ~~Symbol resolution for method calls is unproven.~~ **It works.** Both reviewers built it
  independently; ts-morph reaches the builder-method symbol and recovers the replacement text
  verbatim, with no false positive on an adjacent correct chain. _(Draft 2 does not even need
  it — a name list plus a dot-prefix heuristic is sufficient and more robust.)_
- ~~The `shouldExtend` collision needs the 0.18 rename first.~~ **Non-issue, twice over.** The
  type checker disambiguates by declaration site (`src/conditions/class.ts:11` carries no tag;
  `src/builders/class-rule-builder.ts:221` does), and textually the dot-prefix separates them.
  Decide the rename on its own merits.

## Unrelated defect surfaced by review

**ADR-007's dogfooding example is broken.** As written (`adr/007:80-89`),
`resideOutsideFolder('src/core/engine')` → `notDependOn('ts-morph')` would **false-red against
20+ existing test files** that already import ts-morph.
`tests/archunit/arch-rules.test.ts` consistently scopes every rule with
`.resideInFolder('**/src/**')`; the ADR snippet is missing that scope. Fix separately — it is
not this proposal's job, but the defect is real.

## If approved

Graduates to a numbered plan: source the deprecated-symbol list from `src/` → scan
`docs/*.md` text → report with replacement text → fixture-test against `HEAD~3` (8/8) and the
bare-`shouldExtend` false-positive guard.
