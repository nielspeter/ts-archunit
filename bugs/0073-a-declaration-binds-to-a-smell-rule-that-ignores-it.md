# Bug 0073: a declared-empty carrier binds to a smell rule that ignores it, so the declaration is certified and asserts nothing

**Reported:** 2026-08-08 · **Fixed:** not yet
**Found in:** the five-persona review of [plan 0089](../plans/completed/0089-presets-forward-their-options.md)
(architect, round 2), with the documentation face of it reported independently by the customer persona.
**Severity:** **High** — by blast radius rather than by frequency, per this repo's convention. Nothing
regresses today: 0089 is additive and no floor reads the declaration yet. It is High because
[plan 0099](../plans/0099-the-floor-no-family-can-be-born-below.md) arms the thing that reads it, and
reads it via `declaresEmpty()` — which this family answers `true` with nothing setting it. A user who
follows `docs/presets.md`'s worked example today therefore buys **permanent silence** on that family the
day the floor lands, which is the outcome the whole carrier exists to prevent.

## What happens

`SmellBuilder.collectViolations()` never reads `_expectEmpty`. `.expectEmpty()` was hoisted to
`TerminalBuilder` by [plan 0097](../plans/completed/0097-the-declared-empty-grammar.md), so every family
**has** the method; the smell family does not **act** on it.

Measured on this repo's own `tests/fixtures/smells/duplicate-bodies` fixture, which contains a real
83%-similar pair:

| call                                                    | result                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `duplicateBodies(p).minLines(3).withMinSimilarity(0.8)` | **1 violation** — the duplicate is found                               |
| the same, plus `.expectEmpty()`                         | **1 violation**, and **no** config finding                             |
| `declaresEmpty()` on that builder                       | **`true`**                                                             |
| `emptyDeclarationAdvice()` on that builder              | `expectEmpty: ['preset/agent/no-copy-paste'] in this preset's options` |

The second row is a **false declaration over a corpus that plainly is not empty**, and it produces
nothing. Compare the rule-builder family, where the same false declaration is an unsuppressable finding
that expires the declaration — the property `docs/presets.md` sells as the whole difference from
`overrides: { id: 'off' }`.

## Why it is worse than "one family lags"

**The preset layer certifies the declaration as bound.** `agentGuardrails` pushes the smell builder
through `declareEmptyIfListed` and records the id in `constructed`, so `declaredEmptyFindings` sees a
bound id and stays silent. Its stated principle is _"a declaration that binds to no rule is not a weaker
assertion, it is no assertion"_ — and a declaration that binds to a rule which ignores it is **also** no
assertion. The mechanism checks **binding**, not **effect**.

**`declaresEmpty()` returns `true`, and that is what 0099's floor reads to stand down.** So the
declaration's only working effect today is to suppress the floor that has not shipped yet. A user who
writes it now gets no expiry, and once 0099 lands they get permanent silence on that family rather than
a fact that expires.

**0089 made the bad remedy followable.** Before it, the advice said `.expectEmpty()` — a call a preset
user cannot make, so nobody acted on it. Now it names the exact array to paste, for a family where
pasting it does nothing. That is a remedy verified to _read_ well and not to _remediate_, which is
[ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 2's failure with extra confidence.

**The docs teach it.** `docs/presets.md`'s worked `expectEmpty` example is
`expectEmpty: ['preset/agent/no-copy-paste']`, three lines under a new guarantee that reads _"A false
declaration fails, and does not hide what it was covering."_ The headline example is the one family
where the guarantee does not hold.

## Scope

The same question applies to every family that inherits `expectEmpty()` from `TerminalBuilder` without
acting on it. The rule builders and `correspondence` act on it (`correspondence` per side). The smell
family does not. **The others have not been measured** — that enumeration is part of the fix, not an
assumption, and it is exactly the "covers the families someone remembered" shape
[ADR-009](../adr/009-a-pass-is-constructed-from-evidence.md) exists to name.

## Two candidate fixes

1. **Make `SmellBuilder` honour `_expectEmpty`** — report the false declaration when the corpus is not
   empty, stay silent when it is. Consistent with the other families, and it makes the docs' example
   true.
2. **Make `declaredEmptyFindings` refuse an id whose builder cannot act on it** — a declaration that
   binds to an inert rule reports as unbound. Cheaper, but it forbids the docs' example rather than
   honouring it, so it needs a docs change too.

(1) is the better shape; (2) is the safety net if the family's semantics turn out to make (1)
ambiguous — "what does an empty corpus mean for a pairwise detector" is a real question, and the answer
belongs with the family that has it, per `assertsSomething()`'s precedent.

Whichever ships, the guard is the one this bug was measured with: a **false** declaration over a corpus
with a known duplicate must produce a finding, and the row must assert by id rather than by count.
