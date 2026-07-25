# Proposal 018 — An Adoptable Discovery Surface

**Status:** Draft 3 — **parked**, pending [bug 0010](../bugs/0010-violation-identity-embeds-absolute-paths.md).
Drafts 1–2 proposed four asks; a code survey plus architect and product review found
three of them were already solved, already shipped, or forbidden by ADR-008. What
survives is the strategic question and one precondition, both stated below.
**Priority:** the _question_ is high — this is the library's largest unexploited
capability. The _proposal_ is not schedulable until 0010 lands.
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

## The precondition: bug 0010

Adoption is impossible today for a mechanical reason, not a philosophical one.
Violation identity embeds **absolute file paths**, so a baseline generated locally
matches **nothing** in CI — on any machine, forever. `withBaseline()`, the documented
way to accept existing debt, does not work for this surface at all.

That is filed as bug 0010 and should be fixed on its own merits: it also breaks every
`strictBoundaries` user's baseline, so it is not a discovery-surface concern.

**Until 0010 lands, there is nothing to propose.** With it landed, the honest next
step is to _try_ adoption on a real codebase with a working baseline and see what
actually blocks it — rather than designing a budget primitive for a problem that a
functioning ratchet may already solve.

## The open question, narrowed

After 0010, one genuine design question remains:

> Is `withBaseline()` sufficient to adopt a 700-finding surface, or is a
> **violation budget** needed?

Arguments for a budget: no 700-entry file to review, no regeneration merge conflicts,
incidental cleanup is rewarded. Arguments against: it is a cardinality check
(ADR-008 rule 5), the count is nonlinear for a pairwise detector — extracting one
shared helper used in 20 places drops the count ~190 — and a stale-baseline-entry
failure gives the same ratchet at _identity_ granularity, which the ADR prefers.

**Decision: hold** until either 0010 ships and a real adoption attempt shows the
baseline is insufficient, or a second, unrelated user asks. One project hand-rolling
it twice is a signal, not a mandate. If it is built, name it for the contract, not
the mechanism: `--max-violations` / `.atMost(n)`, mirroring ESLint's
`--max-warnings`. Not "ratchet"; not "allowlist", which already means `.excluding()`
in this codebase's vocabulary.

## Ship now, independent of all the above

Two items need no proposal and no release:

1. **Document the severity flip.** `docs/ai-agents.md` states the warn severity as a
   fact without telling an agent-focused reader they can set
   `overrides: { '<rule-id>': 'error' }`. That is the whole of the drafts' §3.
2. **Fix the "default" claims.** `docs/smell-detection.md:7,174` and the terminal
   table at `:56` call `.warn()` the default; there is no default — a terminal must be
   called. `README.md:292` demonstrates `.warn()` without the alternative.

And one small correctness fix: give `strictBoundaries`' duplicate-bodies
registration the `because`/`suggestion` metadata it lacks
(`src/presets/boundaries.ts:172-176`), so that if a user _does_ flip it to error they
get a remedy rather than a bare message.

## Out of scope

- **The reachability gap** — factory-returned arrows and computed-key assignments
  (0066 shipped the object-literal and method-shorthand shapes). Real, and it blocks
  4 of the 13 advisory rules in the audit, but a different mechanism.
- **`remedyOptional` metadata** — plan 0068 parked the question here; this proposal
  hands it back. It is a question about ADR-008's discriminator, not about discovery.
- **New detectors.** This is about making the two that exist usable.
