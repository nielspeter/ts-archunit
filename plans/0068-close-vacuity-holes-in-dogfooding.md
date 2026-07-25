# Plan 0068: Close the Vacuity Holes in Our Own Dogfooding

## Status

- **State:** Ready to build. **Rewritten 2026-07-25** after a three-persona review demolished draft 1 — see "What review changed".
- **Priority:** P2. Draft 1 claimed P1 on a hindsight argument that does not survive: all four `console.warn` defects landed in **one commit** (`3d8b0f5`, 2026-03-26), four months before ADR-008 existed. No rule could have caught them, and the post-ADR evidence runs the other way — `src/builders/correspondence-builder.ts:253` shows an author declining a `console.warn` and citing ADR-008. Review enforcement is working; this is a regression guard, not a rescue.
- **Effort:** ~2h for phases 1–2; phase 3 is a 2-line fix that can ship today.
- **Created:** 2026-07-25
- **Depends on:** nothing. (Draft 1 depended on proposal 019; that rule moved **into** 019 — see Ordering.)
- **Breaking:** No. `tests/` only.

## What review changed

Draft 1 proposed three dogfooded ADR-008 rules. Measured against real `src/`,
**two of the three could not fail and the third was wrong**:

| Draft-1 phase                         | Measured outcome                                                                                                                   | Now                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1 — `console.warn` in finding paths   | Name-scoped (`/(collectViolations\|evaluate)$/`) → **rename-blind**, unscoped → selects a test fixture, and covers 11 of ~85 paths | **Moved into proposal 019** |
| 2 — `imperative` may not ship at warn | **Does not compile**; premise factually wrong; would red ADR-sanctioned warns                                                      | **Dropped** — see below     |
| 3 — ban `toMatchSnapshot`             | **0 of 2** real snapshot shapes. Blind, not clean                                                                                  | **Reformulated** (phase 2)  |

A plan about preventing rules that cannot fail proposed two rules that cannot fail.
Draft 1 caught that once, by spiking phase 1, and then failed to apply the same
discipline to phases 2 and 3. **Every rule below now carries its measurement.**

### Why phase 2 (imperative-at-warn) is dropped, not deferred

Draft 1's Problem section claimed three preset rules pair an agent-directed
`imperative` with `'warn'`. Verified: **false**. `boundaries.ts` and `layered.ts`
contain **zero** `imperative` fields — they register through `collectRule()`, which
sets only `{ id }`. One site matches, not three.

More decisively, the rule would contradict ADR-008. `recommended.ts` ships
`no-silent-catch` and `no-empty-bodies` with an `imperative` at `'warn'`, and
ADR-008 blesses exactly those two, by name:

> our own `recommended` preset ships two warn-level rules **deliberately** —
> `no-silent-catch` and `no-empty-bodies` have known, suppressible false positives…
> A finding the reader is expected to judge has an optional remedy and **should**
> warn.

The ADR's discriminator is **whether the remedy is optional**. `imperative` is not a
proxy for it — `buildImperative()` synthesises one for every rule. The property is
not machine-readable today.

**The product question this raises belongs in [proposal 018](../proposals/018-adoptable-discovery-surface.md):**
should `RuleMetadata` carry an explicit `remedyOptional` (or advisory) flag, so that
"agent-directed instruction at an unobservable severity" becomes checkable at all —
for every user's rules, not just ours? That is the generic primitive; an AST rule
scoped to `src/presets/*.ts` is the narrow feature ADR-006 warns against.

## Problem

Our dogfooding has vacuity holes. The one draft 1 set out to fix was speculative;
the one review found is **live and larger**.

### 13 existing dogfood rules are conditionally vacuous — this is the real finding

Thirteen rules in `tests/archunit/arch-rules.test.ts` scope with
`resideInFolder('**/ts-archunit/src/**')`. That glob depends on the **checkout
directory being named `ts-archunit`**, which is not a property of the repository.
Measured from a worktree at a different path:

```
glob '**/ts-archunit/src/**'  ->  functions=0    classes=0    (36 rules pass)
glob '**/src/**'              ->  functions=955  classes=94
```

Clone into `arch/`, use a git worktree, or rename the folder, and thirteen rules —
`adr005/no-any`, `adr005/no-as-cast`, `security/no-eval`, `quality/typed-errors`,
`hygiene/no-empty-bodies`, `hygiene/no-stubs`, and seven more — select **nothing**
and pass. Apply ADR-008's question: _what would these do if the thing they guard were
completely broken?_ **Pass.**

That is a live false green across most of our ADR enforcement, found while
reviewing a plan about false greens.

### A self-contradicting remedy

`quality/no-console-log` and `quality/no-console-log-fn`
(`tests/archunit/arch-rules.test.ts:518,519,532`) carry
`suggestion: 'Replace console.log() with console.warn() or remove it'` — recommending,
in an enforced rule, the channel ADR-008 says the consumer never reads.

## Phase 1 — Make the existing dogfood rules non-vacuous

Two changes, both mechanical:

1. **`.expectNonEmpty()` on every rule in the file.** It ships on `RuleBuilder`
   (`src/core/rule-builder.ts:165`), produces a `bypassFilters` meta-finding, and
   fires on **0** subjects. Necessary, not sufficient — it would not have caught
   draft 1's near-miss, which had 1 subject where 11 were expected.
2. **A subject-set identity assertion**, cross-checked against a **non-AST**
   derivation. Per ADR-008 rule 5, a second ts-morph query is not independent
   evidence; a text scan is. Compare **sets of `file:line`**, never counts — rule 4
   is explicit that a change losing one hit and gaining another passes a count.
   `tests/docs/deprecation.test.ts` already models exactly this shape and can be
   reused.

Also replace the path-dependent glob with one derived from the repo, not the
directory name.

**Files:** `tests/archunit/arch-rules.test.ts`, `tests/archunit/subject-sets.test.ts` (new).

## Phase 2 — Rule 4: ban snapshot assertions in agent-consumed tests

ADR-008's own nominated mechanical rule. **Draft 1's formulation was blind.**
Measured on a fixture containing the two shapes that actually occur:

| Formulation                                                       | Catches                          |
| ----------------------------------------------------------------- | -------------------------------- |
| `functions(...).notContain(call('toMatchSnapshot'))` — as drafted | **0 of 2**                       |
| `calls(p).that().withMethod(/toMatch(Inline)?Snapshot/)`          | **2 of 2** (incl. inside `it()`) |

Two independent reasons the drafted version fails: `call(string)` matches the
**callee text**, so it never matches the member form `expect(x).toMatchSnapshot()`;
and `functions()` does not collect the anonymous arrow passed to `it(...)`, which is
where every real snapshot lives.

```typescript
calls(p)
  .that()
  .withMethod(/toMatch(Inline)?Snapshot/)
  .should()
  .notExist()
  .rule({
    id: 'adr008/no-snapshot-assertions',
    because:
      'A snapshot is a pin, not an assertion: the sanctioned repair for a red ' +
      'snapshot is to regenerate it, which an agent will do (ADR-008 rule 4).',
    suggestion: 'Assert the specific properties that matter.',
    imperative: 'Do NOT add a snapshot assertion — assert the properties you mean',
  })
  .check()
```

`(Inline)?` is required: rule 4 covers `toMatchInlineSnapshot` too, which neither
`'toMatchSnapshot'` nor `/toMatchSnapshot/` matches.

**Live corpus: 0 subjects, 0 hits** — genuinely clean, so this is a ratchet. That
makes the can-fail proof load-bearing, and it must use a **verbatim real shape**
(`expect(x).toMatchSnapshot()` inside an `it()` callback), not a synthesised
`toMatchSnapshot()` call, which is the shape that let draft 1's version look proven.
Two caveats to probe while building: `calls()` matches full callee text, so a rule
written in a file under `tests/` can **match its own source line** — scope away from
`tests/archunit/` and verify; and ADR-008 rule 4's narrow exception (rendered CLI
output) must be excluded **by construction**, e.g. a designated folder outside the
glob, never `.excluding()`.

**Files:** `tests/archunit/arch-rules.test.ts`, fixture under `tests/fixtures/`.

## Phase 3 — Stop recommending the invisible channel (ship standalone)

Correct `because` / `suggestion` on **both** `quality/no-console-log` and
`quality/no-console-log-fn` so they stop naming `console.warn` as the remedy; point
at `noConsole()` (`src/rules/security.ts:59`) or "throw / return a violation".

Add the cheap guard so it cannot come back: assert no rule-metadata string in that
file matches `/console\.warn/`. Rule 2's corollary — if a message's content is prose,
assert the prose.

This is two lines plus a test and depends on nothing. **Ship it first, on its own.**

**Files:** `tests/archunit/arch-rules.test.ts`.

## Phase 4 — Amend ADR-008 (last, not first)

Draft 1 made this Phase 0. Review was right that amending **first** and demonstrating
**second** records "the condition is met" while the rules do not work — which is what
happened. It moves to the end, and records what actually shipped.

Two preconditions:

1. **ADR-008 is still `Proposed`** and has never been accepted. Resolve that before
   editing its Enforcement prose.
2. The amendment states **obligations**, not permission. A mechanical ADR-008 rule is
   admissible only if it: is scoped by construction (never by checkout path); has a
   can-fail fixture copied verbatim from a real shape; has an independently-derived
   (non-AST) hit set asserted by identity; and has a recorded subject count with the
   sanity check below.

Lift draft 1's heuristic into the ADR itself, where review agreed it belongs:

> **A subject count of 1 where you expected 10 is the tell.** Run every new rule
> against the real corpus, count the subjects, and confirm it reds on a known defect
> or a fixture before landing it.

**Files:** `adr/008-agent-first-failure-surfaces.md`.

## Ordering

1. **Phase 3** — independent, 2 lines, today.
2. **Phase 1** — the live false green; independent of everything else.
3. **Phase 2** — independent.
4. **Phase 4** — after 1–3, recording what shipped.

**Proposal 019 now owns the `console.warn`-in-finding-paths rule.** Review's argument
is sound: 019 is a four-site fix that "designs nothing new", so fixing and guarding in
one commit removes the ordering problem entirely and avoids a plan depending on an
unreviewed proposal. The measured formulation to carry over is **structural, not
name-based** — draft 1's name regex is blind to a rename, which is the exact
anti-pattern the motivating audit named:

```typescript
functions(p)
  .that()
  .resideInFolder('**/ts-archunit/src/**') // see phase 1 — this glob needs fixing too
  .and()
  .haveReturnType(/ArchViolation\[\]/) // unanchored: the type resolves to an absolute import path
  .should()
  .notContain(call(/^console\./)) // not just console.warn — error/info/debug are equally invisible
```

Measured: **24 subjects, 7 hits** — all four defects, plus three in `applyFilters`
that 019 rules out of scope. Those three are a feature: they force an explicit,
recorded decision rather than a selector that silently cannot see them.

## Out of scope

- **Rules 1, 2, 3 and 5 as general mechanical checks.** ADR-008's rejection stands:
  they are properties of prose, and rule 5 as a rule would need its own rule-5 guard.
- **`imperative`-at-warn** — dropped; the property is not machine-readable. The
  `remedyOptional` question goes to proposal 018.
- **Object-literal `evaluate` methods** (~54 in `src/conditions/`) are invisible to
  `functions()`. Real, and the same reachability gap proposal 018 names — not this
  plan's to close.
