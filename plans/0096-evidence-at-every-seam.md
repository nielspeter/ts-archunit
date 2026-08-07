# Plan 0096 — evidence at every seam, and the preview that reads it

**Status:** Open, not started. Filed 2026-08-07, split out of plan 0095's Phase 1.
**Depends on:** [0095](./completed/0095-the-vacuity-matrix-and-the-conformance-audit.md) — its truth table names
which families need wiring, and the matrix is what independently checks this plan's work.
**Priority:** High. It is the diagnostic-first half of the migration
[ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 1's corollary requires: the release that
previews the flip has to ship before the release that flips.
**Effort:** Medium. Five families, one accessor, one diagnostic kind.
**Blast radius:** **Published API, additive** — `check()` behaviour does not change, but `diagnose()`
gains a finding kind and both hosts stop being "without running any of them". Middle row of ADR-008
rule 6, with one top-row edge: `DiagnosticFinding['kind']` is a documented JSON contract.

## Problem

[ADR-009](../adr/009-a-pass-is-constructed-from-evidence.md) requires a passing verdict to be constructed
from evidence of examination. Nothing computes that evidence today. Before the seam can require it
([0098](./0098-the-evidence-seam-and-the-floor.md)), every family has to produce it — and the consumer
has to be able to see what the flip will do to them before it happens.

## The work

**Each family counts its examined units at its own seam**, exposed through a **public** accessor on
`DiagnosableRule`. Public is forced, not chosen: a protected member cannot satisfy that structural
interface, which is the recorded reason `assertsSomething()` is public.

The `RuleBuilder` grammar needs no wiring — measured, not assumed: `filterElements()` returns the one set
that is both the selection and what conditions receive, and the one builder suspected of narrowing
outside it (`within()`'s scoped functions) narrows by overriding `getElements()`, which `filterElements()`
calls. Probed with 2 calls matched and zero callbacks extracted: it threw. So for that grammar,
examined ≡ selection, and the 0.34.0 guard already **is** ADR-009's floor. Recorded as an equivalence.

| family               | examined unit                                                    |
| -------------------- | ---------------------------------------------------------------- |
| duplicateBodies      | bodies entering pairwise comparison, post-`minLines`             |
| inconsistentSiblings | the grouped sibling-file set entering `partitionByPattern`       |
| correspondence       | keys of both sides, summed                                       |
| graphql schema       | schema fields entering the chain                                 |
| graphql resolvers    | collected resolver functions                                     |
| tsconfig             | `no-corpus` — the requirements object is the input, not a corpus |

**`zero-subjects` lands in `src/core/diagnose.ts`, not in the doctor wrapper.** Doctor stays a renderer,
"two hosts, one diagnosis" stays true, and — the reason it matters — a rule file that imports a test
runner gets a preview after all: `expect(diagnose(rules)).toEqual([])` runs inside the consumer's own
suite. ADR-008 rule 1's corollary admits doctor cannot load those files; putting the kind in the core is
what stops that admission from being the end of the story.

The preview must derive from **the same computation** 0098 will gate on. A migration instrument derived
differently from its own gate is a rule 5 violation inside the migration.

## Priced honestly in the release notes

`check()` is unchanged, but this is not "nothing breaks": doctor-in-CI users see new findings (doctor
exits non-zero on anything it reports), the documented `DiagnosticFinding['kind']` union grows a member,
diagnosing now **runs** each family's selection-and-filter counting, and suites calling `diagnose()` get
a time increase. The changelog leads with the instruction, not the description: _run `doctor` /
`diagnose()` now; what it reports under `zero-subjects` goes red next release._

## Files changed

The five family files above, `src/core/diagnose.ts`, `src/cli/commands/doctor.ts`, `docs/cli.md` (the
"without running" sentence and the kind table), `docs/api-reference.md` (the JSON contract),
`CHANGELOG.md`, `plans/ROADMAP.md`; this plan moves to `plans/completed/`.

## Test inventory

- **Per family, a files>0 / units=0 fixture** — five of them, one per family outside the `RuleBuilder`
  grammar. Each must hold **every upstream count non-zero** (files loaded, globs matched, pre-filter
  selection non-empty) while the seam count is zero. That makes the fixtures a behavioural provenance
  guard: evidence wired to any upstream layer (`examined: sourceFiles.length` and its cousins) reds them.
  The residue — same-layer miswirings — stays review-enforced, per ADR-009's Notes.
- **The rule-family equivalence recorded, not re-tested**, with the `within()` regression row asserting
  the guard that is now load-bearing as the floor.
- **diagnose/doctor**: `zero-subjects` fires on a files>0/units=0 fixture — **and does not fire beside
  `project-empty` on a zero-file project**. Without that negative row, release A double-reports every
  empty project and prefigures 0098's precedence wrongly.
- **Sabotage**: break one family's evidence computation → diagnose's row moves with it. Same-derivation
  by design; the matrix from 0095 is the independent check, and that is stated rather than disguised.
  Verdicts read **per test**, not per row.

## Out of scope

The seam retype and anything that changes `check()` — [0098](./0098-the-evidence-seam-and-the-floor.md).
The declared-empty grammar — [0097](./0097-the-declared-empty-grammar.md). Evidence inside a
user-written `defineCondition` body: ADR-009's named residue, invisible to a seam that counts what was
handed to it.
