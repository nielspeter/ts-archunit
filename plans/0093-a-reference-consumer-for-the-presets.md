# Plan 0093 — a reference consumer for the presets

**Status:** Open, not started. Split out of
[plan 0083](./0083-eat-our-own-dogfood.md) Phase 3 on 2026-08-04, when that phase's **two hard
requirements shipped without it** (v0.51.0) and it became clear the wrapper was a separate decision.
**Priority:** Medium, and **argue it before building it** — see the section below. This is the only plan
here whose first task is to justify its own existence.
**Effort:** Medium-large, and mostly in the assertion design rather than the fixture.
**Blast radius:** **An internal check over a corpus we control.** Bottom row of
[ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6 — prove each detector fires once and stop.
The risk here is not under-guarding, it is building an artifact that costs more than it catches.

## What plan 0083 Phase 3 already got, without this

- **`scripts/verify-package.mjs`** — every `exports` subpath resolves by package name, every target ships,
  and every specifier the repo itself writes maps to a subpath. That was the urgent gap: 12 subpaths with
  nothing resolving one, across six releases.
- **`tests/presets/rules-are-idempotent.test.ts`** — each preset's rule array built once, evaluated three
  times, compared by identity. Bug 0034's class, guarded.

Neither needed a reference consumer. So what is left is the _third_ thing Phase 3 bundled: **every preset,
one project, one process, asserting per-rule-id findings.**

## The honest case against it, first

Phase 3's own text warns that a whole-project finding set is "a snapshot in all but name — with a
snapshot's churn and none of the `-u` escape hatch, so every genuine detection improvement reds the file
and gets hand-edited." That is the failure mode, and it is not hypothetical: this repository has already
shipped a release correcting fourteen statements that had drifted from behaviour.

So the first task is not code. **It is to name a defect this would catch that nothing else does**, and to
check it against what now exists:

| Candidate defect                               | Already covered by                                            |
| ---------------------------------------------- | ------------------------------------------------------------- |
| A preset's `exports` subpath does not resolve  | `scripts/verify-package.mjs`                                  |
| State leaks between two runs of one rule array | `rules-are-idempotent.test.ts`                                |
| State leaks between two _different_ presets    | same file's union row                                         |
| A preset's glob discovers nothing              | `assertDiscovered` + each preset's own test                   |
| Two presets' rules interfere in one `checkAll` | `tests/integration/shape-presets-check.test.ts` (two presets) |
| A rule stops firing entirely                   | **not covered** — the strongest candidate                     |

If the honest answer is only that last row, this is a much smaller plan than Phase 3 imagined: a test that
every declared rule id produces at least one finding somewhere, which needs no reference project at all —
`orphanExclusions`' trick of deriving ids from `describeRule()` already does the hard half.

**Consider closing this plan in favour of that.** Recording the reasoning is worth more than the artifact
if the artifact's only justification is "completeness".

## If it is built, the design constraints Phase 3 already earned

Do not rediscover these:

- **Assert `Record<ruleId, elements>`, not the finding set.** Keys asserted against the declared-id set
  derived from `describeRule().id` — which handles `agentGuardrails`' template-literal ids. A rule that
  stops firing then shows as a key with an empty array rather than vanishing from a shorter list.
- **Pin values only for designated instances**, each commented with which bug shape it stands for.
  Everything else is churn.
- **The vacuity floor is satisfied by total vacuity**, which is the trap. `assertDiscovered` returns a
  `bypassFilters: true` finding when a glob discovers nothing, so a project whose every glob misses
  produces a **non-empty** finding list and a cardinality band accepts it. Three rows instead:
  configuration findings asserted `toEqual([])` by identity; the set of ruleIds producing _ordinary_
  findings asserted against the declared set; and an explicit justified-silent list so "this rule reported
  nothing" fails closed.
- **Assert through the JSON/`checkAll` path, not `.check()` terminals.** `recommended` ships two
  deliberate warn-level rules, and a `.warn()` finding inside a test reaches nobody
  ([bug 0024](../bugs/fixed/0024-warn-terminal-is-invisible-inside-a-test-runner.md)) — so through
  `.check()` every warn-severity rule is invisible and silently uncovered.
- **Declaration order is part of the derivation** when state is the subject. Learned in
  `rules-are-idempotent.test.ts`: only the row that runs first sees a cold module, so exactly one row can
  catch a module-level leak.

## Test inventory

Deliberately not written. It depends entirely on the answer to "what does this catch that nothing else
does", and writing an inventory first is how the artifact acquires momentum it has not earned.

## Related

- [Plan 0083](./0083-eat-our-own-dogfood.md) Phase 3 — where this came from, and what shipped without it.
- [Bug 0034](../bugs/fixed/0034-comment-matcher-underreports-and-goes-silent-on-re-evaluation.md) — the
  justification Phase 3 cited, now covered at its own level.
- `tests/integration/shape-presets-check.test.ts` — already spreads two presets through the real `check`
  pipeline, and is the thing this would generalise.
