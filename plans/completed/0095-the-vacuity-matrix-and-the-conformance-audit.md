# Plan 0095 — the vacuity matrix, and the ADR-008 conformance audit

**Status:** **DONE 2026-08-07.** Filed 2026-08-06, re-cut 2026-08-07: the original spanned two releases
and three phases, which is not a plan under this repo's rule that a plan is completed — and moved to
`completed/` — in the PR that does its work. Split into 0095 (this), [0096](../0096-evidence-at-every-seam.md),
[0097](./0097-the-declared-empty-grammar.md) and [0098](../0098-the-evidence-seam-and-the-floor.md).
**Priority:** High, and **first** — it is the only piece with no dependencies, and its deliverable is the
evidence [ADR-009](../../adr/009-a-pass-is-constructed-from-evidence.md) is ratified on.
**Effort:** Medium. The classification is dozens of reviewed entries across twelve subpaths; the test is
small.
**Blast radius:** **An internal check over a corpus we control** — no shipped behaviour changes here.
Bottom row of [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 6: prove each detector fires and
stop. The matrix's own controls are that proof.

## Problem

ADR-009's premise is that vacuity guards have been added family by family, each wave complete over its
enumeration and each followed by a family outside it. That premise currently rests on **two measured
cells and a dozen unmeasured ones**:

| cell                                                                       | result on the 0.58.0 dist                                      |
| -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `smells.duplicateBodies(p).check()`, zero files                            | **PASSED** — fail-open (bug 0066)                              |
| `smells.inconsistentSiblings(p).check()`                                   | threw the asserts-nothing finding — the vacuity cell is masked |
| `schema(dir, glob)`, zero `.graphql` files                                 | **THREW** — the loader fails closed; one family conforms       |
| `resolvers`, CLI `check`, `.warn()` per family, presets × smells, tsconfig | **never measured**                                             |

An ADR ratified on two cells is an argument. Ratified on the full table it is a measurement — and if the
table comes back showing the families already guarded, ADR-009 needs rewriting rather than ratifying.
**That is why this plan runs before the ADR is Accepted, not after.**

## The work

A matrix that enumerates every published check-constructor from the `package.json` exports map, probes
each over a zero-subject corpus, and records a three-way verdict. It changes no shipped behaviour: it
asserts **today's** truth table, so the audit is a measurement now and a regression guard afterwards.

Everything below is ADR-009's Enforcement section made concrete; the decision content lives there.

**`tests/matrix/enumerate.ts`** — one enumeration for the whole suite, exposed two ways: a pure-data
module (subpath list, importable anywhere) and a dist-importing prober (package self-reference, recursing
into namespace-object exports, matrix-only). `assertion-gate.test.ts`'s hand-maintained
`[rootExports, graphqlExports]` list migrates to the pure-data module — one surface, one enumeration —
while still importing `src`, so the default suite needs no build.

**`tests/matrix/vacuity-classification.ts`** — every export classified as a discriminated union, each
check naming its **examined unit** in writing (ADR-009 part 1 makes that a reviewed claim):

```ts
type Entry =
  | { kind: 'check'; unit: string; recipe: (c: Ctx) => Probeable; deviation?: string }
  | { kind: 'preset'; unit: string; recipe: (c: Ctx) => Probeable[]; deviation?: string }
  | { kind: 'helper' | 'class' | 'namespace' | 'no-corpus' }
```

**`tests/matrix/vacuity-matrix.test.ts`** — the probes and the controls.

## Binding constraints

- **Completeness, both directions.** Every discovered export appears in the classification; every
  non-`control:` entry corresponds to a live export.
- **Recipes are the bare construction**, `deviation` required when they are not — bug 0066 measured why:
  bare `.check()` passed while `.inFolder(…)` threw, so a decorated probe certifies the guarded cell.
- **Three controls, permanent, each in its own `it()`** — `fail-open`, `other-throw` and
  `config-finding` fakes through the identical probe function. Two are not enough: a probe that
  classifies every throw as `other-throw` satisfies both and reports every real cell wrong.
- **The population is asserted before its contents.** `parsed.length === textual call occurrences`,
  and ≥ 9. `0 === 0` is green — that is exactly how the first draft of this matrix passed while
  inspecting 0 of 9 call sites.
- **Freshness by build stamp**, hashing `src/**` plus `tsconfig.build.json` and `package.json`. Git and
  CI caches scramble mtimes in both directions.
- **Wiring**: excluded from the default vitest include; `test:matrix` builds then runs; explicit
  post-build steps in **both** `ci.yml` and `publish.yml` (the `verify-package.mjs` pattern — tests run
  before build in both workflows and `dist/` is gitignored). Sequence after bug 0062's reusable-workflow
  extraction if it has landed, so this does not become a third hand-maintained gate copy.

## Deliverable

The completed truth table, appended to [bug 0066](../../bugs/0066-a-smell-detector-over-zero-files-passes.md)
and to this plan, and **linked from the changelog** — it is the falsifiable backing for the claim the
later plans will make. `KNOWN_FAIL_OPEN` records what it finds, bounded by a dated `AUDIT_2026_08`
constant it may only shrink from, and expires (the matrix reds if the list is non-empty once the package
version reaches 0098's target) so a stalled programme fails the audit rather than living behind it.

## Files changed

`tests/matrix/enumerate.ts`, `tests/matrix/vacuity-classification.ts`, `tests/matrix/vacuity-matrix.test.ts`,
`tests/matrix/fixtures/empty/tsconfig.json` (new); `tests/core/assertion-gate.test.ts` (consumes the shared
data); `vitest.config.ts`; `package.json`; `.github/workflows/ci.yml`; `.github/workflows/publish.yml`;
`bugs/0066-*.md` (truth table appended); `CHANGELOG.md`; `plans/ROADMAP.md`; this plan moves to
`plans/completed/`.

## Test inventory

- completeness both directions; unclassified export fails.
- per-cell probe at `.check()` **and** `.warn()`, three-way verdict recorded.
- audit-mode exactness — a cell moving in either direction fails.
- ratchet (`KNOWN_FAIL_OPEN ⊆ AUDIT_2026_08`) and expiry.
- all three control fakes, asserted individually, never via `KNOWN_FAIL_OPEN`.
- build-stamp freshness.
- CLI `check` over the empty fixture — behaviour recorded (ADR-009 assigns this row here).

## Out of scope

Fixing anything the matrix finds. This plan **measures**; 0096–0098 change behaviour. A cell that comes
back fail-open is recorded, not repaired — including bug 0066's, whose fix belongs to
[0098](../0098-the-evidence-seam-and-the-floor.md) so the seam and the smell family land as one red event.

---

## Outcome

Built and measured 2026-08-07. `tests/matrix/` — enumeration from the exports map, a classification
of all 328 published bindings, twenty probed constructors, three controls — plus post-build steps in
`ci.yml` and `publish.yml`, and `npm run test:matrix`. The full table is appended to
[bug 0066](../../bugs/0066-a-smell-detector-over-zero-files-passes.md).

**ADR-009's premise holds.** Four families fail open — `smells.duplicateBodies`,
`smells.inconsistentSiblings`, and both shipped presets when a smell rule is the only one enabled.
Ten cells are guarded, and `graphql:schema` fails **closed** by its own loader.

Three things the measurement found that no reading had:

1. **Both presets fail open**, which corrects bug 0066's own claim that the silent path is "a
   smell-only rule file or the direct API". Its six-of-seven measurement was of rules that were
   **enabled**; enable only `noCopyPaste` and the preset has one rule, and it fails open.
2. **`dataLayerIsolation` constructs zero rules** from a valid option — vacuity one level above the
   one this matrix probes, and not covered by 0098's fix.
3. **Three of my own twenty recipes were wrong**, and would have been published as findings. Two used
   `.notExist()` — the sanctioned cardinality exemption — so the cell passed because the assertion was
   satisfied, not because it was vacuous; two more asked the question of families with no corpus. That
   is why the recipes carry a required `deviation` field and why `NO_CORPUS` is a written category
   rather than an omission: the hand-maintained part of this instrument is where its errors live.

**Guarding the guard.** Sabotage: flipping one recorded verdict reds 2 tests; deleting one export from
the classification reds 1. The three control fakes prove the probe distinguishes all three verdicts —
two would not, since a probe that never returns `config-finding` satisfies both of the others.

**Deferred, deliberately:** the migration of `assertion-gate.test.ts` onto `SUBPATHS`. The shared
enumeration exists and is exported for it, but that test is green and untouched, and rewriting a
working census is not this plan's work. `enumerate.ts`'s `SUBPATHS` is importable without a build
precisely so that migration stays cheap.
