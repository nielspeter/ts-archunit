# Proposal 013 — Docs Deprecation Scan

**Status:** Open — proposed (**draft 3**; see "Draft history" — draft 1 proposed a compile
harness; draft 2's matching rule measured blind to its own headline evidence)
**Priority:** Medium — the docs are at **zero** deprecated usages today. This is purely
preventive, and that is precisely why now is the cheapest it will ever be.
**Affects:** `tests/` only — no `src/`, no public API, no new dependency. Uses ts-morph (ADR-002) + vitest (ADR-001).
**Origin:** ts-archunit's own docs. A manual sweep on 2026-07-17 found 18 usages of
deprecated builder methods across four doc pages — including reference tables in
`core-concepts.md` and `classes.md` presenting them as the canonical API — found by accident
while writing an unrelated page.

> **The sweep was itself incomplete, and that is the strongest argument in this document.**
> It checked a **hand-written list** of class-builder names, never enumerated the module/type
> builders, and **missed 9 of 27 usages** — including `modules.md:49`, a reference-table row
> presenting a deprecated name as canonical. Found only under review; fixed in `5ff08d0`.
> **A hand-maintained list checking for drift is itself a check that cannot fail.**
>
> Draft 2 then made the same mistake one layer down: it de-hand-listed the _what_ (names from
> `src/`) and hand-coded the _how_ (a dot-prefix rule), which measured **blind to
> `core-concepts.md` entirely** — its own bolded evidence. **Every part of this check must be
> derived from `src/`, including the disambiguation rule.** That is the load-bearing lesson.

## Problem

**The docs rot and nothing catches it.** 307 ```typescript blocks across 31 doc pages are
never compiled, and no gate reads doc prose at all. `npm run validate` (typecheck + lint +
format + test) sees none of it, because it lives in markdown.

1. **Nothing checks docs at all.** No extractor, no compile pass, no lint pass over markdown.
2. **A compile check alone cannot catch this class.** `shouldResideInFile` compiles perfectly
   — it is **deprecated, not removed**. Deprecation is invisible to `tsc`.
3. **Nothing else flags deprecation either.** `@typescript-eslint/no-deprecated` is not
   enabled, and eslint does not lint markdown regardless.

### Evidence — 27 usages across 7 pages (measured at `8ddd33e`)

| Page               | Usages | Notes                                                                |
| ------------------ | ------ | -------------------------------------------------------------------- |
| `what-to-check.md` | 10     | The recipe gallery — the page users copy from                        |
| `classes.md`       | 6      | Including reference-table rows                                       |
| `modules.md`       | 5      | **`:49` is a table row** presenting the deprecated name as canonical |
| `core-concepts.md` | 3      | **Conditions table** — two-column, no example column                 |
| `functions.md`     | 1      | Reference-table row                                                  |
| `slices.md`        | 1      |                                                                      |
| `cli.md`           | 1      |                                                                      |

Decomposes as **22 dotted call-sites + 5 bare table/prose mentions** — a distinction that
turns out to decide the whole design.

Drift vectors are ongoing: plan 0062 renamed preset APIs, the 0061 restructure moved pages
wholesale, and **8 unique deprecated names across 10 declarations**
(`conditionHaveNameMatching` is deprecated on the class, type, and function builders) carry
`@deprecated` tags pointing at replacements the docs did not adopt.

### Honest sizing

**Deprecated ≠ broken.** A reader copying `shouldResideInFile` gets a **working** rule. The 9
live usages were fixed in `5ff08d0`, so **the docs are clean today and this scan is purely
preventive.** Real harm, in order:

1. Teams running `@typescript-eslint/no-deprecated` get lint failures **sourced from our
   docs** — pointed, for a lint-adjacent tool.
2. IDE strikethrough on code copied from official docs reads as "unmaintained."
3. Silent debt at 1.0 removal, for people who followed the docs correctly.

**The best argument is timing, not harm:** a preventive check is cheapest at the exact moment
the thing it protects is clean. That is today. Every week we wait it rots again, and the scan
lands red with a backlog to triage before it is useful.

## Proposed design

**A deprecation scan over all markdown text.** ~60 lines, ~1s, no new dependency.

**Everything is derived from `src/` in one ts-morph pass. Nothing is hand-maintained.**

1. **Deprecated names + replacement text** — walk the builders, collect methods carrying an
   `@deprecated` JSDoc tag, capture the tag's text. Dedupe by name (10 declarations → 8
   names); **assert** the replacement text agrees across duplicate declarations rather than
   assuming it.
2. **The collision set** — in the same pass, read `src/index.ts`'s exports **including aliased
   re-export forms** (`haveNameMatching as conditionHaveNameMatching`). A deprecated name that
   is _also_ a live export is ambiguous in prose; one that is not is unambiguous.
3. **Match per-name, derived from (2):**

```js
// COLLIDE — also a live export, so a bare mention is ambiguous; only the dotted
//   method call is unambiguously rot.
//   conditionHaveNameMatching, shouldExtend, shouldImplement, shouldHaveMethodNamed
// SOLO — exists only as a deprecated method, so any mention is rot.
//   notImportFromCondition, notImportFromConditionWithOptions,
//   shouldResideInFile, shouldResideInFolder
const pattern = collides.has(name)
  ? new RegExp(`\\.${name}(?!\\w)`)
  : new RegExp(`\\b${name}(?!\\w)`)
```

The `(?!\w)` right-boundary guard is **required**, not cosmetic: `notImportFromCondition` is a
strict prefix of `notImportFromConditionWithOptions` and double-counts without it.

4. **Report with the replacement text the tag already carries:**

```
docs/what-to-check.md:178 — `shouldResideInFile` is deprecated:
  Use `resideInFile()` after `.should()` instead.
```

### Measured (pinned corpus `8ddd33e`)

| Design                              | Hits        | False positives            |
| ----------------------------------- | ----------- | -------------------------- |
| Bare match everything               | 27 / 27     | **3** (`api-reference.md`) |
| Dot-prefix everything (**draft 2**) | **22 / 27** | 0                          |
| **Collision-aware (this draft)**    | **25 / 27** | **0**                      |

25/27 across **all 7 pages**, zero false positives on `api-reference.md`, which correctly
documents the live exports.

### Known limit — stated, not papered over

**2 of 27 are undecidable from text**: a bare mention of a name that is _both_ a deprecated
method _and_ a live export — `core-concepts.md:176` and `classes.md:56`, both bare
`conditionHaveNameMatching` in a two-column table. These are character-identical in shape to
`api-reference.md:188`, which documents the real export correctly. The disambiguating
information **is not present in the text**, and no compile path rescues it — they are table
rows, not code.

We take 25/27 with zero false positives over 27/27 with three. A scan that cries wolf on
correct documentation gets ignored, and an ignored check is worse than no check.

### Binding constraint

> **No hand-maintained ignore list. Ever.**

If a false positive appears, the fix is to derive better from `src/` — never an allowlist.
This is the single rule that keeps this on the right side of the proposal 012 precedent, which
died partly because its escape hatch was "a hand-maintained string that drifts — the very
artifact this proposal exists to abolish."

### Acceptance test

**Pin the SHA — do not use a relative ref.** Draft 2 cited `HEAD~3`, which had already moved
by the time it was written.

- **`8ddd33e`** (pre-sweep) → assert **25/27**, all 7 pages red, **0** hits in
  `api-reference.md`.
- The 2 undecidable cases are encoded as **explicit documented exceptions**, so a future fix
  that catches them turns the test red and forces a deliberate update.
- **`1c279af`** → the 8-usage `notImportFromCondition` subset. Useful, but **not sufficient as
  a bar**: every one of those 8 is a dotted call-site — the population any design handles.
  Certifying on it alone would have passed draft 2, which is blind to `core-concepts.md`.

A green acceptance test on a corpus containing only the cases the design handles is _a check
that cannot fail_.

## Why text, and why that is consistent with rejecting 012

Proposal 012's `beRunIn()` was rejected partly for being a regex over foreign text. This scan
is a regex over text. **The distinction is real, and worth stating explicitly rather than
leaving implicit:**

|                           | 012 `beRunIn`                                                          | This scan                                                          |
| ------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Precise mechanism exists? | **Yes** — and was declined. Ground truth needs executing the CI graph. | **No.** Markdown table rows have no AST. Text is the only option.  |
| Ambiguity                 | **Unbounded** — arbitrary YAML, arbitrary CI shapes                    | **Bounded and enumerable** — 8 names, 4 ambiguous, all from `src/` |
| Hand-maintained artifact  | `opts.pattern` — drifts                                                | **None.** Constitutionally forbidden (above)                       |
| Blast radius              | A stranger's green CI                                                  | A maintainer's 30 seconds                                          |

**We hold user-facing API to type-checker precision and internal tooling to bounded,
source-derived text matching. That is deliberate** — the standards track blast radius and
domain closure, not politics.

**What does _not_ relax at any layer is "can this check fail?"** That is about the check's
honesty, not its audience. It is the test draft 2 flunked, and the reason this draft exists.

## Scope — living docs vs design records

- **In:** living user-facing docs — `docs/**/*.md`, `README.md`. (Use a recursive glob;
  `docs/` being flat is an undefended assumption.)
- **Out:** design and historical records — `ts-archunit-spec.md`, `plans/`, `proposals/`,
  `adr/`. These intentionally describe unbuilt or superseded API; drift there is **expected,
  not a defect**, and flagging it produces permanent noise that trains people to ignore the
  check.
- Exclusions are **single literal paths, never globs** — an exclusion that can silently grow is
  the drift vector this proposal exists to kill.
- Runs in `npm test`. ~1s needs no separate `test:docs` entry point. (Check whether the
  ts-morph Project load can be shared with `tests/archunit/arch-rules.test.ts:21`, which
  already pays it.)

## Alternatives considered

- **`eslint-plugin-markdown` + `@typescript-eslint/no-deprecated`.** Rejected: it sees only
  fenced code, missing the table rows entirely — and snippets are fragments (224 of 307 use
  `p` without defining it), so they need a preamble engine to parse at all.
- **Batched `getSuggestionDiagnostics()`** (`code=6385`, `reportsDeprecated=true`) — genuinely
  precise, and **strictly dominated for this question**: where it works (fences) the population
  is dotted call-sites, already unambiguous by text and already 22/22; where text is ambiguous
  (bare names in tables) there is nothing to compile. It buys precision only where precision is
  already free.
- **Keep sweeping by hand.** Not impossible — `5ff08d0` shows the hand method done _right_,
  sourcing names from `src/`, and it worked. But that was under review pressure on the day it
  was salient. The drift vectors are continuous; the check is 2 hours and runs forever. This is
  a **cost** argument, not an impossibility argument.
- **Compile harness first** — draft 1's design. Deferred; see below.

## Deferred — the compile harness (draft 1's proposal)

Not rejected. **Re-propose at the 1.0 removal milestone.**

Draft 2 gated it on "evidence that removed/renamed API drift occurs" — which is **circular**:
nothing checks docs, so that drift is unobservable by construction (except via user bug
reports, the channel this product exists to replace). **A date is a gate someone can satisfy.**
At 1.0, when the 8 deprecations are actually removed, the class converts from unobserved to
**certain**, and every doc still teaching them goes from strikethrough to broken.

Retained for whoever picks it up: 215/307 blocks compile naively, 224/307 with
import-stripping, ~11s for all 307 in one in-memory project. If built: use **batched**
`getSuggestionDiagnostics()`, not a `forEachDescendant` + `getSymbol` walk — the latter is the
chatty per-node pattern ADR-007 identifies as fatal for TypeScript 7. Assembly is simpler than
draft 1 thought: `noUnusedLocals` is **off**, so union all entry-point exports (336 unique
names; 28 dual-reachable, all root re-exports → "root wins" is collision-free) and omit only
names the block binds. ~20 lines.

**The largest failure bucket looked like doc bugs and was not** — `agentGuardrails`,
`noAnyProperties`, `noTypeAssertions`, `mustMatchName` are real exports from sub-entry-points
(`/presets`, `/rules/*`) that a root-only preamble cannot supply. Acting on naive output would
have "fixed" correct documentation into incorrect documentation. **The honest failure count
does not exist until the harness is scope-aware.**

### The ~13 possible real bugs — tracked, not evaporated

Draft 2 said "run the spike once, triage the ~13, discard." That does not survive this
document's own text: the ~13 comes from the _naive_ run we just called unreliable. A
triage-able list needs the scope-aware preamble first — i.e. most of the harness. **File it as
a tracked issue** with the spike data attached and the entry cost stated honestly, behind 0047.
If it is worth doing it survives as an issue; if not, that becomes an explicit decision rather
than evaporation.

## Companion — enable `@typescript-eslint/no-deprecated` for `src/` only

Separate ~15-minute PR, not part of this proposal (different surface: code, not docs).

We cite this rule's absence as evidence **twice**, and harm claim (1) above is _"teams running
`no-deprecated` get lint failures sourced from our docs"_ — **we ask users to run a rule we do
not run ourselves.** `typescript-eslint ^8.57.2` is already a devDependency;
`eslint.config.ts:10` uses `recommendedTypeChecked`, which does not include `no-deprecated` (it
lives in `strictTypeChecked`).

**`src/` only.** It is **not** a one-line change for `tests/`: ~74 deprecated call-sites live
there and are **legitimate** — those tests exist to cover the deprecated methods, which are
still supported API. Blanket-disabling 74 sites to satisfy a linter is worse than not running
it. `src/` appears clean, so this is a free permanent guard against us internally adopting our
own deprecated API.

This also resolves an inconsistency: `plans/ROADMAP.md:195` defers 0048 partly because it
_"overlaps `@typescript-eslint/no-deprecated`"_ — we defer work on the grounds a rule covers
it, while not running the rule.

## Layering (settled)

**A bespoke vitest test — do not dogfood this one.** The decisive reason: **the DSL's entry
points take an `ArchProject`, and markdown has no Project to load.** Teaching the DSL about
markdown to serve exactly one user (us) is ADR-006's rejected shape — the same error as 012's
`beRunIn` baking foreign-format knowledge into core. A CLI command is worse: it ships internal
tooling as public surface.

**Keep the `@deprecated` reader test-local.** One caller. The codebase's only JSDoc reading is
`src/rules/code-quality.ts:30` — and that is a _rule_, not a helper; there is no JSDoc-helper
layer to join. Extract only when a user-facing `noDeprecatedUsage()` rule wants a shared
`getDeprecatedTag(node)`. Not before.

## Draft history

**Draft 1** proposed a compile harness with deprecation as Phase 3. Rejected: fence extraction
cannot see markdown table rows (where the worst rot lives); deprecation needs no harness; and
the harness defends a drift class with **zero observed instances** at 3–4 days, ahead of
decided user-facing work (0047).

**Draft 2** proposed the text scan — correct shape — with a **blanket dot-prefix rule**.
Measured against the real corpus it found **22 of its own 27 documented usages** and scored
**zero on `core-concepts.md`**, the evidence it bolded as worst. The blind spot did not close;
it moved.

**Draft 2's "resolved" open questions, corrected:**

- ~~Symbol resolution for method calls is unproven.~~ **Still true: it works** — both reviewers
  built it independently and recovered the replacement text verbatim. Draft 3 does not need it;
  a source-derived name list is sufficient and more robust.
- ~~The `shouldExtend` collision is a non-issue; the dot-prefix disambiguates cleanly.~~
  **False — this claim is withdrawn.** The dot-prefix does not disambiguate cleanly; it trades
  false negatives for false positives, and draft 2 silently took the false-negative side at a
  cost of 5 true positives including its own headline. The collision is **4 names, not 1**
  (`conditionHaveNameMatching`, `shouldExtend`, `shouldImplement`, `shouldHaveMethodNamed`) —
  and it is **derivable from `src/`**, which dissolves the heuristic. 2 residual cases are
  genuinely undecidable and are documented as a known limit.

## Unrelated defect surfaced by review

**ADR-007's dogfooding example is broken — twice.** `adr/007:80-89` uses `entry(project)`, and
**there is no `entry` export** in `src/index.ts`; the rule is also unscoped, so as written it
would false-red against **107 files under `tests/`** and **54 under `src/`** outside
`src/core/engine/` that import ts-morph. `tests/archunit/arch-rules.test.ts` consistently
scopes every rule with `.resideInFolder('**/src/**')`. Out of scope here — file it separately.

## If approved

Graduates to a numbered plan: one ts-morph pass over `src/` for names + replacement text + the
collision set → per-name matching with the right-boundary guard → scan living docs → report
with replacement text → fixture-test pinned at `8ddd33e` asserting 25/27, with the 2
undecidable cases as explicit exceptions and 0 hits in `api-reference.md`.
