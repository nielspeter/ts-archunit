# Plan 0101 — the shared explanation is printed once, not per finding

**Status:** Open, READY. Filed 2026-08-08, split out of
[0099](./completed/0099-the-floor-no-family-can-be-born-below.md) — it was the fourth of that plan's four
advice-string defects, and the only one that is not text inside a producer.
**Depends on:** [0099](./completed/0099-the-floor-no-family-can-be-born-below.md). Not for the code — this change
stands alone — but for the **need**: until the floor fires at check time, the long explanation is printed
by `doctor` only, where a reader asked for a report and a wall of prose is the point. The floor is what
turns it into `check` output, repeated once per failing rule.
**Priority:** Medium. Ergonomics of a message, not correctness of a verdict.
**Effort:** Small-medium.
**Blast radius:** **Published API — top row** of [ADR-008](../adr/008-agent-first-failure-surfaces.md)
rule 6, and it is easy to under-rate. The finding text **is** the product for the agent consumer ADR-008
is written for, and this changes what every zero-subjects finding says in four renderers. A per-finding
form that drops a fact the agent needed is a rule 2 defect shipped at scale.

## Problem

0099's zero-subjects finding carries ~70 words: the cause, the numbers, the widening remedy, the
declaration remedy in the family's own spelling, and the caveat about which is which. That is right for
one finding and wrong for twelve.

`recommended` alone builds four rules against one `include` glob. A project whose sources are not under
`src/` gets **four** findings, each repeating the same paragraph, differing only in the rule name — and
0099's own release note calls `recommended` "the largest blast radius in the release". `strictBoundaries`
fans out per boundary, so the count scales with the user's architecture.

The facts differ per finding. The explanation does not. Printing the invariant part N times buries the
part that varies, which is the part the reader has to act on.

## The work

**Split the message at the seam between fact and explanation.**

- **Per finding** — what is true of _this_ rule: the id, the selector, the numbers 0099 already computes
  ("the project loaded 412 files; this rule's selection produced 0"), and the one remedy that names this
  rule's own knob, in the family's own spelling from `emptyDeclarationAdvice()`.
- **Once per run** — the invariant explanation: why zero examined is a failure rather than a pass, how
  widening differs from declaring, and when each is right.

**Where "once" lives is the design question, and it has no precedent in this repo** — measured: no
renderer emits a run-level footer today. Three candidates, and the plan should pick one on measurement
rather than taste:

1. A `notes` channel on the result the renderers already receive, rendered last. Most invasive, most
   reusable, and the only one that survives a consumer who reorders findings.
2. A `kind`-keyed lookup the renderer owns, printed when it emitted at least one finding of that kind.
   No data-model change; each renderer repeats the "did I emit one" bookkeeping.
3. Leave the long form on the **first** finding of a kind and shorten the rest. Cheapest, and wrong under
   `--changed` / baseline, which can drop the first one and take the explanation with it — the same class
   of defect review found in 0089's "reported below this finding".

(3) is recorded to be refused, not considered: it makes the explanation's presence depend on a filter
that runs later.

**Four renderers, and they do not agree today** — `format.ts`, `format-json.ts`, `format-github.ts`,
`explain.ts`. JSON must carry the explanation as a field rather than concatenating it into `suggestion`,
or a consumer parsing `suggestion` gets a different string per finding for one cause. `format-github.ts`
emits locationless findings as run-level annotations already, which is the closest thing to a footer this
repo has and is worth reading before designing (1).

**`doctor` keeps the long per-finding form, or states why not.** It is a report, its reader asked for
detail, and 0096 shipped that surface deliberately. If the two surfaces diverge, the divergence is a
decision to write down — the `diagnose()`/`check()` agreement row in 0099's inventory is about _which
inputs_ report, not about identical prose, and this plan should say so rather than leave the next reader
to re-derive it.

## Files changed

`src/core/format.ts`, `src/core/format-json.ts`, `src/core/format-github.ts`,
`src/cli/commands/explain.ts`, the producers in `src/core/terminal-builder.ts` that 0099 leaves behind,
whichever run-level type candidate (1) needs, `docs/cli.md` (sample output), `CHANGELOG.md`.

## Test inventory

- **The explanation appears exactly once for N findings of one kind** — N ≥ 3, asserted per renderer, and
  by identity rather than by count: the per-finding forms must still differ from each other.
- **Every fact the old single message carried is still reachable**, per finding. This is the row that
  stops the split becoming a deletion — enumerate the facts from the 0099 string, not from memory.
- **The family spelling still substitutes.** `CorrespondenceBuilder`'s per-side form must survive into the
  short form, since `.expectEmpty()` is a `TypeError` there.
- **JSON carries the explanation as its own field**, and `suggestion` stays per-finding and actionable.
- **Under `--changed` and baseline**, where some findings are dropped, the explanation still appears for
  those that survive — the (3)-shaped defect, asserted rather than avoided by design.
- **A single finding reads correctly.** The degenerate case is the common one for a small project, and a
  split tuned for twelve can read like a fragment at one.
- **Sabotage:** the "once" bookkeeping reverted to per-finding, and the explanation dropped entirely —
  each must fail a row, patches asserted to apply **and to compile**.

## Out of scope

The floor itself and its per-cause remedies — [0099](./completed/0099-the-floor-no-family-can-be-born-below.md).
The wording of the explanation's content, which 0099 settles; this plan moves it, and changes it only
where the split forces a seam.
