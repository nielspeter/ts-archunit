# Proposal 018 — An Adoptable Discovery Surface

**Status:** Draft 4 — **unparked.** The precondition (bug 0010) is fixed on a
spike branch, and the one open design question was settled by measuring a real
adoption run rather than by argument: the baseline is sufficient, the budget
primitive is not needed. What remains is shipping 0010 and two docs fixes.
Drafts 1–2 proposed four asks; a code survey plus architect and product review found
three of them were already solved, already shipped, or forbidden by ADR-008, and the
fourth was a real bug.
**Priority:** high, and now schedulable — the blocker has a measured fix.
**Origin:** a 2026-07 coverage audit of a large adopting codebase, plus that
project's earlier rule inventory ("flip checklist"). Both external; evidence
reproduced here.

## Why this exists (do not lose this)

ts-archunit has two halves. The **enforcement** half is mature and heavily used. The
**discovery** half — `smells.duplicateBodies`, `smells.inconsistentSiblings` — is
shipped, documented, and used essentially **zero times**.

The audit that motivated the 0.18 program measured what that costs. A genuine power
user of the enforcement surface — **177 enforced rules, 1 warn**, agent-first
messages throughout — ran the discovery surface not once. Pointing `duplicateBodies`
at it surfaced **~700 findings that all 177 enforced rules were blind to**, including
the copy-paste parser rot this library was built to prevent (spec §1.1), now realised
at scale.

That is the strategic case, and it is unchanged by everything below: **enforcement
catches what someone already thought to forbid; discovery is the only surface that
finds the drift nobody named.** For a codebase being written faster than it can be
reviewed, the second is the one that compounds. Closing this gap is the moat.

## What review established

The obvious diagnosis — _advisory findings are invisible to an agent, so promote them
to `.check()`_ — is wrong on the facts, three times over:

| Ask (drafts 1–2)                   | Finding                                                                                                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Make findings fail instead of warn | **No API needed.** `SmellBuilder extends TerminalBuilder`, and `overrides: { 'preset/agent/no-copy-paste': 'error' }` works **today**. Undocumented, that is all. |
| Agent-first messages on the smells | **Already shipped** for `agentGuardrails` (`id`/`because`/`suggestion`/`imperative`). Only `strictBoundaries` lacks them — 3 lines.                               |
| A shrink-only **count** ratchet    | **ADR-008 rule 5 forbids it**: "compare identities… not integers." A budget is green when one duplicate is deleted and another appears.                           |
| Ratchet-stable identity            | **A real bug, and worse than measured** → extracted to [bug 0010](../bugs/0010-violation-identity-embeds-absolute-paths.md).                                      |

The flip-checklist corroborates the diagnosis being wrong. Across 13 rules that stay
advisory **by design** in that project, the stated blockers were: reachability (4),
legitimate exceptions (3), debt volume (4), real design work (2) — and **severity
zero times**. Nobody chooses `warn` because they want a softer signal.

## The precondition: bug 0010 — fixed on a spike branch

Adoption was impossible for a mechanical reason, not a philosophical one. Violation
identity embedded **absolute file paths**, so a baseline generated locally matched
**nothing** in CI — on any machine, forever. `withBaseline()`, the documented way to
accept existing debt, did not work for this surface at all. Measured across two
checkouts of one commit: 1006 findings each side, **0 shared identities**.

That is [bug 0010](../bugs/0010-violation-identity-embeds-absolute-paths.md), fixed on
its own merits — it broke every `strictBoundaries` user's baseline too, so it was never
a discovery-surface concern. The spike also closed three further instabilities that
move identity without moving the checkout (file-walk order, derived population counts,
line coordinates).

With that in hand the honest next step was to _try_ adoption rather than design for it,
which is what the section below reports.

## The open question — now answered by measurement

The question was:

> Is `withBaseline()` sufficient to adopt a ~1000-finding surface, or is a
> **violation budget** needed?

The 0010 spike made it testable, so it was tested rather than argued. The spike
build was installed into an isolated checkout of a real adopting project and the
whole adoption path was run:

```
cold             check()             -> FAILS, 1006 findings
accept the debt  check({ baseline }) -> PASSES          (1006 entries)
plant 1 new dup  check({ baseline }) -> FAILS, 165 NEW  (all naming the planted file)
```

**`withBaseline()` is sufficient. No budget primitive is needed.** Existing debt
goes green, new debt goes red, and the ratchet is a ratchet rather than a mute
button.

The same run also kills the budget idea on its own terms. Copying **one** file
produced **165** new findings: a pairwise detector is quadratic in the duplicated
surface, so the count is not a measure of how much debt was added, and a
threshold on it would be noise. That is ADR-008 rule 5 — "compare identities, not
integers" — observed rather than asserted. It was previously an argument; it is
now a measurement.

**Decision: do not build it.** Revisit only if a second, unrelated user asks for
a reason this run did not cover.

## Ship now — done

Both docs items shipped with 0.19.0:

1. **The severity flip is documented.** `docs/ai-agents.md` now shows
   `overrides: { 'preset/agent/no-copy-paste': 'error' }`, and says why it
   matters — the CLI's exit code counts error-severity findings only, so a
   warning is invisible to an agent loop that stops at `exit 0`.
2. **The "default" claims are gone.** `docs/smell-detection.md` said `.warn()`
   was the default in three places and the terminal table asserted it outright;
   there is no default, a terminal must be called. `README.md` demonstrated
   `.warn()` with no alternative. All corrected, and the smell pages now point
   at `withBaseline()` as the way to adopt a backlog at error severity rather
   than warning it away.

## Still open, and larger than this proposal estimated

The third item read: _"one small correctness fix — give `strictBoundaries`'
duplicate-bodies registration the `because`/`suggestion` metadata it lacks
(3 lines)."_ That was wrong. The metadata is not missing from one registration;
it is missing from **every rule routed through `collectRule`**
(`src/presets/shared.ts:32`), which attaches `{ id }` and nothing else.

Measured: `strictBoundaries` emits **37 rules, 37 of them with no `because` and
no `suggestion`.** Twelve `collectRule` call sites span `boundaries.ts`,
`layered.ts` and `data-layer.ts`.

So three of the shipped presets violate ADR-008 rule 2 — every failure carries
its sanctioned fix — for every rule they emit. `agentGuardrails` is the
exception and shows the target shape
(`src/presets/agent-guardrails.ts:121-128`): `id`, `because`, `suggestion`,
`imperative`.

This is a separate piece of work from the discovery surface, and it wants
writing 12 remedies carefully rather than filling in a template.

## Out of scope

- **The reachability gap** — factory-returned arrows and computed-key assignments
  (0066 shipped the object-literal and method-shorthand shapes). Real, and it blocks
  4 of the 13 advisory rules in the audit, but a different mechanism.
- **`remedyOptional` metadata** — plan 0068 parked the question here; this proposal
  hands it back. It is a question about ADR-008's discriminator, not about discovery.
- **New detectors.** This is about making the two that exist usable.
