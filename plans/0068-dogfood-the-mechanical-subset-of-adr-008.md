# Plan 0068: Dogfood the Mechanical Subset of ADR-008

## Status

- **State:** Ready to build.
- **Priority:** P1 — ADR-008 is the only binding ADR with **zero** dogfooded rules, and that gap has now produced real defects (below).
- **Effort:** ~2–3h.
- **Created:** 2026-07-25
- **Depends on:** [ADR-008](../adr/008-agent-first-failure-surfaces.md), and **amends its Enforcement section** (see Phase 0 — this is a precondition, not a side effect).
- **Breaking:** No. `tests/` only, plus four `src/` call sites fixed in
  [proposal 019](../proposals/019-rules-that-enforce-nothing-must-fail.md) if that
  lands first. This plan can ship independently; ordering is discussed below.

## ADR-008 currently says NOT to do this

Read this before anything else:

> **We deliberately do not dogfood these as ts-archunit rules.** ADR-007's own
> dogfooding example is instructive: as written it references a non-existent export
> and is unscoped, so it would false-red against 107 test files. An unenforceable
> rule stated honestly beats an enforced rule that is wrong.

That decision stands for rules 1–3, and this plan does **not** touch them. But the
same ADR set an explicit condition for revisiting:

> Rejected **for now** — see Enforcement. **Worth revisiting if a mechanical subset
> emerges** (rule 4 is plausibly checkable: ban `toMatchSnapshot` in `tests/`).

**That condition is now met.** A 2026-07-25 audit of `src/` found a mechanical subset
by hand — four instances of one checkable pattern, plus the one the ADR itself
predicted. Every rule below is derived from a defect that already exists in this
repo, not from a property someone hopes is true. That is the difference between this
and the ADR-007 example the ADR rightly criticises.

## Problem

ADR-008 motivated the whole 0.18 program. It is the one binding ADR with no
mechanical enforcement on ourselves:

| ADR                       | Dogfooded rules                             |
| ------------------------- | ------------------------------------------- |
| ADR-002 (ts-morph only)   | `adr002/no-raw-ts`                          |
| ADR-004 (ESM)             | `adr004/no-require`, `adr004/no-require-fn` |
| ADR-005 (no `any` / `as`) | `adr005/no-any`, `adr005/no-as-cast`        |
| Layering                  | 7 rules                                     |
| **ADR-008 (agent-first)** | **none**                                    |

What that cost, found by hand on 2026-07-25:

1. **Four finding-producing paths report a rule that enforces nothing via
   `console.warn`, then return a pass** — `src/core/rule-builder.ts:435`,
   `src/builders/slice-rule-builder.ts:204`,
   `src/graphql/resolver-rule-builder.ts:144`,
   `src/graphql/schema-rule-builder.ts:162`. Rule 1 violation, four times.
2. **Our own dogfooded rule recommends the invisible channel.** `quality/no-console-log`
   carries `because: 'Use console.warn for user-facing warnings or throw for errors'`
   and `suggestion: 'Replace console.log() with console.warn() or remove it'`
   (`tests/archunit/arch-rules.test.ts:518,519,532`). We are teaching, in an enforced
   rule, the exact channel ADR-008 says the consumer never reads.
3. **Three preset rules carry an agent-directed `imperative` and register at
   `'warn'`** — `preset/agent/no-copy-paste`, `preset/boundaries/no-duplicate-bodies`,
   `preset/layered/type-imports-only`. Covered by
   [proposal 018](../proposals/018-adoptable-discovery-surface.md); the **rule** that
   detects it belongs here.

## Phase 0 — Amend ADR-008 (precondition)

ADRs are binding, so the code cannot contradict one. Update the **Enforcement**
section to record that the stated condition was met, what subset is now mechanical,
and that rules 1–3 remain review-enforced. Keep the ADR-007 caution verbatim — it is
the reason each rule below ships with a can-fail proof.

**Files:** `adr/008-agent-first-failure-surfaces.md`.

## Phase 1 — Rule: finding paths must not report via `console.warn`

The mechanical core of rule 1. A `collectViolations()` implementation that writes to
`console.warn` is reporting a finding on a channel the consumer cannot read, and
(every time so far) returning a pass.

```typescript
functions(p)
  .that()
  .haveNameMatching(/^collectViolations$/)
  .should()
  .notContain(call('console.warn'))
  .rule({
    id: 'adr008/findings-not-console-warn',
    because:
      'A finding written to console.warn is invisible: the CLI exit code counts ' +
      'error-severity violations only, so the run is green and an agent stops reading.',
    suggestion:
      'Return a violation instead. For "this rule enforces nothing", use a ' +
      'bypassFilters meta-finding so it cannot be excluded or baselined away.',
    imperative: 'Do NOT report a finding with console.warn — return a violation',
  })
  .check()
```

Scoped to `collectViolations` deliberately: diagnostics elsewhere (a stale
exclusion, a broad matcher) are advice about the _ruleset_, not claims about the
_code under test_, and `diff-aware.ts` fails safe by design.

**Rule-5 guard (required).** A rule this plan adds must itself be proven able to
fail. A fixture function named `collectViolations` containing `console.warn` must be
flagged; the same function without it must not. Without both halves this is the
ADR-007 mistake — an enforced rule nobody has watched fail.

## Phase 2 — Rule: an agent-directed imperative may not ship at `warn`

`imperative` exists solely to instruct an agent. Registering it at a severity the
agent cannot observe is a contradiction the type system cannot catch.

```typescript
calls(p)
  .that()
  .haveArgumentWithProperty('imperative')
  .should()
  .notContain(expression(/'warn'/))
  .rule({ id: 'adr008/imperative-not-warn' /* … */ })
  .check()
```

The exact shape needs a probe against `src/presets/*.ts` — argument index and
matcher choice are an implementation detail, and the rule must be **scoped to
preset registration** so an unrelated `'warn'` string elsewhere in a call does not
false-red. If no honest formulation is reachable with today's matchers, **state the
gap and skip it** (ADR-008's own guidance) rather than shipping an approximation.

## Phase 3 — Rule: no snapshot assertions in agent-consumed tests

Rule 4, which the ADR itself nominated as the plausible mechanical one:

```typescript
functions(p).that().resideInFolder('**/tests/**').should().notContain(call('toMatchSnapshot'))
```

Expected to pass at zero today — that is fine. It is a ratchet, and its can-fail
proof is a fixture, not the live corpus.

## Phase 4 — Fix the rule that teaches the wrong channel

Correct `because` / `suggestion` on `quality/no-console-log` so it stops recommending
`console.warn` as the remedy. Replace with: throw, or return a violation.

**Files:** `tests/archunit/arch-rules.test.ts`.

## Files changed

| Phase | File                                             |
| ----- | ------------------------------------------------ |
| 0     | `adr/008-agent-first-failure-surfaces.md`        |
| 1–3   | `tests/archunit/arch-rules.test.ts` (+ fixtures) |
| 4     | `tests/archunit/arch-rules.test.ts`              |

## Test inventory

- Phase 1 rule passes on `src/` **after** proposal 019 lands; **fails on `src/` today**
  (4 hits). See ordering.
- Can-fail fixture per rule: one file that must be flagged, one that must not.
- Phase 3 passes at zero; fixture proves it can fail.

## Ordering with proposal 019

The Phase 1 rule **red-flags four real sites in `src/` right now**. Two honest options:

1. **019 first**, then this plan — the rule lands green and stays green. Preferred.
2. **This plan first**, with Phase 1 as the failing test that motivates 019.

What is **not** acceptable is landing Phase 1 with the four sites excluded: an
`.excluding()` that hides the defect the rule exists to catch is precisely the
suppression ADR-008 rule 3 is about.

## Out of scope

- **Rules 2 and 3 as mechanical checks.** "Every failure carries a remedy" and "say
  where there is no escape hatch" are properties of prose. ADR-008's rejection stands.
- **Rule 5 as a mechanical check.** It is the reviewer question. A rule that tried to
  verify independence of derivations would need its own rule-5 guard — the regress
  the ADR names.
- **Enforcing severity on preset registrations** (i.e. changing them) — that is
  proposal 018. This plan adds the rule that _detects_ it.
