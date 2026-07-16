# Proposal 013 — Docs Snippet Compile + Deprecation Test

**Status:** Open — **rewrite required** (architect + product review, 2026-07-17).
The phases are inverted: ship the deprecation **scan** first (~2h, standalone), and demote
the compile harness to a separate, later, evidence-gated proposal. See "Review verdict".
**Priority:** Medium — the scan is P1-ish (live bugs); the harness is P3.
**Affects:** `tests/` only — no `src/`, no public API, no new dependency. Uses ts-morph (ADR-002) + vitest (ADR-001).
**Origin:** ts-archunit's own docs. A manual sweep on 2026-07-17 found 18 usages of
deprecated builder methods across four doc pages — including the reference tables in
`core-concepts.md` and `classes.md`, which presented them as the canonical API. They
were found by accident while writing an unrelated page, and fixed by hand-compiling
snippets in a throwaway scratch file. This proposes automating that workflow.

> **The sweep was itself incomplete — and that is the strongest argument here.** It used a
> hand-written list of class-builder method names and never enumerated the module/type
> builders, so **9 further usages survived it** (`notImportFromCondition` in
> `what-to-check.md`, `modules.md:49` — a reference-table row — `slices.md`, `cli.md`),
> found only during this review and fixed in `5ff08d0`. A hand-maintained list checking for
> drift is itself a check that cannot fail. The real scope was **7 pages, not 4**.

## Problem

**The docs rot and nothing catches it.** 307 ```typescript blocks across 31 doc pages are never compiled. `npm run validate` (typecheck + lint + format + test) does not see them, because they live in markdown.

Three facts make this systemic rather than a one-off:

1. **Nothing checks doc snippets at all.** No extractor, no compile pass, no lint pass over markdown.
2. **A compile check alone would not have caught the bug that motivated this.** `shouldResideInFile` compiles perfectly — it is **deprecated, not removed**. Deprecation is invisible to `tsc`.
3. **Nothing else flags deprecation either.** `@typescript-eslint/no-deprecated` is not enabled in `eslint.config.ts`, and eslint does not lint markdown regardless.

So a doc page can teach deprecated, renamed, or non-existent API indefinitely while every gate stays green.

### Evidence (all real, all found by hand, one sweep)

| Page               | Deprecated usages | Notes                                             |
| ------------------ | ----------------- | ------------------------------------------------- |
| `what-to-check.md` | 8                 | The recipe gallery — the page users copy from     |
| `classes.md`       | 6                 | Including reference-table rows                    |
| `core-concepts.md` | 3                 | **Conditions table** — presented as canonical API |
| `functions.md`     | 1                 | Reference-table row                               |

Drift vectors that produced these are ongoing, not historical: plan 0062 renamed preset APIs, the 0061 restructure moved pages wholesale, and the builder methods carry `@deprecated` tags pointing at replacements the docs did not adopt.

### Why ts-archunit specifically

This is a credibility problem, not just a chore. The product's premise is _"encode the rule so CI catches the drift on the PR that introduces it."_ Our own docs drifted, uncaught, across releases. The fix should be the thing we sell.

## Feasibility — measured, not estimated

A throwaway harness was built and run against all 307 blocks before writing this proposal:

| Strategy                                          | Blocks compiling clean |
| ------------------------------------------------- | ---------------------- |
| Naive (preamble only when block has no imports)   | 215 / 307 (70%)        |
| Strip ts-archunit imports, always inject preamble | 224 / 307 (73%)        |

**Runtime: ~11s** for all 307 blocks in one in-memory ts-morph project — acceptable inside `npm test`.

Measured failure taxonomy:

| Cause                                                                     | Count      | Verdict                       |
| ------------------------------------------------------------------------- | ---------- | ----------------------------- |
| Name unresolved (`TS2304`/`TS2552`) — sub-entry-point exports             | ~124 diags | Harness gap — fixable         |
| Module unresolved (`TS2307`) — `ts-morph` not resolvable                  | 4          | Harness gap — fixable         |
| `TS2440` import conflicts with local declaration (`project`)              | 1          | Harness gap — fixable         |
| Syntax errors (`TS1005`/`TS1128`/`TS1109`/`TS1003`) — genuine pseudo-code | ~17        | Needs skip directive          |
| Cross-block references (`resolved`, `layers`, `app`, `myPreset`)          | ~10        | Needs skip or `declare`       |
| Type errors (`TS2339`/`TS2345`/`TS2554`)                                  | ~13        | **Triage — may be real bugs** |

**The spike's most important finding — and a warning:** the largest bucket looked like doc bugs and was not. `agentGuardrails`, `noAnyProperties`, `noTypeAssertions`, `mustMatchName` all resolve fine; they are real exports from **sub-entry-points** (`/presets`, `/rules/typescript`, `/rules/naming`) that a root-only preamble cannot supply. Acting on the naive output would have "fixed" correct documentation into incorrect documentation. The harness must be scope-aware, and **the honest failure count does not exist until it is.**

## Proposed design

### Two checks, not one

The second check is the point; without it this proposal does not address its own motivation.

1. **Compile check** — catches removed/renamed API, wrong signatures, bad import paths.
2. **Deprecation check** — resolve each identifier to its symbol; fail on a `@deprecated` JSDoc tag, reporting the tag's replacement text. **This is the check that catches the 18 usages.**

```
docs/what-to-check.md:178 — `shouldResideInFile` is deprecated:
  Use `resideInFile()` after `.should()` instead.
```

### Scope-aware snippet assembly

Neither "strip all imports" nor "blanket-inject" works (both measured). Per block:

1. Parse the block's own imports → collect locally bound names.
2. Collect locally declared names (`const project = …`).
3. Preamble imports, from **each** entry point, only public names the block references and has not bound. Fixes `agentGuardrails`, `noAnyProperties`, and the `project` conflict with one rule.
4. If the block uses `p` without defining it, inject `declare const p: ArchProject` — type-level only.

Export lists are read from the real source at test time via ts-morph `getExportedDeclarations()`, so the preamble **cannot drift** from the public API.

**Snippets are only typechecked, never executed.** No tsconfig loaded, no rule run, no filesystem touched.

### Skip directive

Genuine pseudo-code opts out via an HTML comment before the fence (invisible when rendered), and **a reason is mandatory**:

```markdown
<!-- docs-check: skip (pseudo-code — illustrates chain shape only) -->
```

The test fails on a reason-less skip and reports the total skip count, so the escape hatch stays visible instead of silently becoming `@ts-ignore`.

## Alternatives considered

- **`eslint-plugin-markdown` + `@typescript-eslint/no-deprecated`.** Rejected: snippets are fragments (224 of 307 use `p` without defining it), so they do not parse as standalone modules under a type-aware lint pass without the same preamble machinery proposed here. Once the preamble exists, ts-morph gives both checks with one program and zero new dependencies (ADR-002).
- **Executing snippets, not just typechecking.** Rejected: slow, order-dependent, and turns the docs into an integration suite. Typecheck catches the drift class we actually observed.
- **Do nothing / keep sweeping by hand.** The sweep cost ~an hour, required hand-compiling in a scratch file, and only happened by luck. It does not scale across 307 blocks and 31 pages — and it **demonstrably failed**: it missed 9 usages (see the note under Origin).
- **Fix the underlying naming collision instead.** Worth doing, but orthogonal — see Open questions. It reduces future confusion; it does not detect drift.

## Open questions — all answered by review (2026-07-17)

1. ~~**Symbol resolution for method calls is unproven.**~~ **Resolved: it works.** Both
   reviewers independently built it. ts-morph reaches the builder-method symbol through the
   chain and recovers the replacement text verbatim (`shouldResideInFile → "Use
resideInFile() after .should() instead"`), with no false positive on an adjacent correct
   `.should().resideInFile()`. **Does not gate approval.** Note the recommended scan does not
   even need it.
2. ~~**The `shouldExtend` collision.**~~ **Resolved: a non-issue, twice over.** The type
   checker disambiguates by declaration site with no heuristic — the standalone export
   (`src/conditions/class.ts:11`) does not carry the tag; the builder method
   (`src/builders/class-rule-builder.ts:221`) does. And `api-reference.md:194` is a markdown
   **table row**, which a fence-based harness never reads. **Decouple the 0.18 rename
   entirely** and decide it on its own merits.
3. **Skip budget.** Do not set a numeric ceiling — it invites gaming. The mandatory-reason
   rule is the real control. (Moot for the scan, which needs no escape hatch.)
4. **Scope.** The scan is text-based, so `README.md` costs nothing to include. Exclude
   `ts-archunit-spec.md` — it intentionally describes unbuilt API and would emit permanent
   noise.
5. **Where does the time go?** `npm test`. The scan is ~1s. No separate `test:docs` entry
   point — a gate people forget locally.

---

## Review verdict (2026-07-17)

**Rewrite required — invert the phases.** Both reviewers reached this independently.

### The design flaw

**Fence extraction structurally cannot see the worst rot.** This document's own headline
evidence is the _reference tables_ presenting deprecated methods as canonical — and those
are **markdown table rows**, not ```typescript blocks. A fence-based harness catches
**zero** of them. Confirmed live during review: `modules.md:49` was exactly that.

So the centerpiece check misses the class of bug the proposal leads with.

### What to build instead

**A deprecation scan over all markdown text** (~2h, ~60 lines):

- Source `@deprecated` names from `src/` via ts-morph at test time → **cannot drift**, and
  no hand-list can rot (the failure that produced the 9 missed usages above).
- Dot-prefix heuristic separates `.shouldExtend(…)` (rot) from bare `shouldExtend` (the real
  export documented in `api-reference.md`).
- No preamble, no scope-awareness, no `declare const p`, no skip debt, no author friction —
  it cannot fail a snippet for being incomplete.
- Prototyped in review: replayed against pre-sweep docs it found **22 hits vs the sweep's
  18**, table rows included, in ~1s.

**Regression corpus:** `git show HEAD~3:docs/` — all 8 of its rotted fenced usages are a
proven acceptance test.

### On the compile harness

Keep it, but **separate, later, and evidence-gated**:

- It defends removed/renamed API drift — a class with **zero observed instances**. All 27
  known usages were deprecations.
- Realistic effort is **3–4 days, not 1.5–2**; the ~13 "may be real bugs" each need a human
  deciding doc-vs-code, and the honest count can still grow.
- Its genuine unique asset — those ~13 — is **audit value, not regression-test value**. Run
  the throwaway spike once, triage, discard. Do not conflate "found bugs once" with "must
  run forever."
- If built: use **batched** `getSuggestionDiagnostics()` (one call per file,
  `code=6385 reportsDeprecated=true`), not a `forEachDescendant` + `getSymbol` walk — the
  latter is precisely the chatty per-node pattern ADR-007 identifies as fatal for
  TypeScript 7. Batched detection, per-hit enrichment.
- Assembly is over-designed: `noUnusedLocals` is **off**, so unused preamble imports are not
  errors. Union all entry-point exports (336 unique names; 28 dual-reachable, all root
  re-exports → "root wins" is collision-free) and omit only names the block itself binds.
  That collapses step 3 to ~20 lines and fixes the `project` conflict by construction.

### Layering (asked explicitly)

**Keep it a bespoke vitest harness — do not dogfood this one.** ts-archunit's rules operate
over a loaded TypeScript project; snippets are markdown fragments needing extraction before
any project exists. Forcing it through the public DSL means teaching the DSL about markdown
— serving exactly one user (us) and violating the lego-bricks principle. A CLI command is
worse: it ships internal tooling as public surface.

### Unrelated defect surfaced

**ADR-007's dogfooding example is broken.** As written (`adr/007:80-89`),
`resideOutsideFolder('src/core/engine') → notDependOn('ts-morph')` would **false-red against
20+ existing test files** that already import ts-morph. `tests/archunit/arch-rules.test.ts`
consistently scopes every rule with `.resideInFolder('**/src/**')`; the ADR snippet is
missing that scope. Fix separately — but once fixed, `tests/docs/` needs no exclusion.

### Correction to this document

`docs/` has **31** pages, not 29.

## If approved

Two proposals, not one:

1. **Deprecation scan** (~2h) — graduate to a plan, build now. Fixes a live credibility hole
   in the thing we sell.
2. **Compile harness** — re-propose after a release cycle, gated on evidence that
   removed/renamed drift actually occurs rather than the assumption it will.
