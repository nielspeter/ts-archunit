# Plan 0097 — the declared-empty grammar

**Status:** Open, not started. Filed 2026-08-07, split out of plan 0095's Phase 2c/2f.
**Depends on:** nothing in code — it is additive and can land any time. It **must precede**
[0098](./0098-the-evidence-seam-and-the-floor.md), whose floor reads the mint this plan lifts.
**Executes** [ADR-010](../adr/010-the-extension-surface-is-a-contract.md) rule 3(a), accepted there from
the consumer's side. One mechanism, two documents served — which is why it is its own plan rather than a
line inside another.
**Priority:** High, and cheap. It is the only prerequisite 0098 has that is entirely in our hands.
**Effort:** Small-medium. One hoist, one method conversion.
**Blast radius:** **Published API.** The hoist is additive; the `allowEmpty` conversion is breaking, and
it is on the extension contract's root, so ADR-010's process applies. Top row of ADR-008 rule 6.

## Problem

[ADR-009](../adr/009-a-pass-is-constructed-from-evidence.md) part 3 rules that empty is legitimate only
by **declaration**, and that every family's grammar must expose a declaration path. Two things stand in
the way, and they pull in opposite directions:

1. **`.expectEmpty()` / `.expectNonEmpty()` live on `RuleBuilder`** (`src/core/rule-builder.ts:140-180`),
   so the smell family — the one bug 0066 is filed against — cannot reach them. Bug 0066 listed "is
   `.expectEmpty()` reachable on a smell builder at all?" under **Not measured**; the answer is no.
2. **`correspondence().allowEmpty(side)` already ships the forbidden shape** — a permanent, non-expiring
   "empty is fine" that its own failure messages instruct users to call. The rule family rejected this
   twice with receipts (plan 0069's appendix; the cardinality hardening that made it unexpressible
   there), and a sibling family has it documented and live.

## The work

**Hoist** `.expectEmpty()` / `.expectNonEmpty()` and their contradiction guard from `RuleBuilder` to
`TerminalBuilder`, so every family reaches them. `copy()` carries the boolean through the existing clone
path; no fork-state work.

**Convert** `allowEmpty(side)` to `expectEmpty(side?)` on `CorrespondenceBuilder`. An **optional**
parameter, because a required one is not a valid override of the zero-arg base method: with a side, the
per-side expiring assertion; without, the whole-rule declaration.

**Rule the composition explicitly**, because the obvious reading is a remedy loop: for correspondence,
"declared empty" is the whole-rule boolean **OR every side individually declared**. Without the OR, a
user who declared all their sides still reds with a finding telling them to declare — ADR-008 rule 2's
loop shape. Declaring _some_ sides does not set it.

**On the mints** — this plan lifts one of the two the token subsumes, so state the shape it lands in:
the cardinality `WeakSet` registry guards user-constructible **condition objects**, the surface with the
measured forgery record; the `_expectEmpty` boolean guards **builders**, a protected field behind a
sanctioned method, carried by copy-on-write where registry membership keyed on a builder would be lost at
the first `copy()`. One consumer, two mints, no third mechanism. ADR-009 part 2 was amended to say this.

## Migration — two-branched, and one intent is removed

`allowEmpty` meant "this side may be empty, don't fail on it". `expectEmpty(side)` means "this side must
BE empty, and this fails the day it isn't". A blind rename is correct only for users whose side is empty
right now:

| the user's side today | migration            |
| --------------------- | -------------------- |
| empty                 | `.expectEmpty(side)` |
| has keys              | delete the call      |

The third intent — _"sometimes empty, silently"_ — is **removed, not renamed**, per ADR-009's
Alternatives. The changelog says so out loud rather than letting a user discover mid-upgrade that their
intent no longer exists after being told the migration was mechanical.

## Files changed

`src/core/terminal-builder.ts`, `src/core/rule-builder.ts`, `src/builders/correspondence-builder.ts`,
`tests/core/config-findings-carry-their-own-remedy.test.ts` (asserts the correspondence remedy contains
`.allowEmpty(` — flips, **with a remediation row**, not just a contains flip), `docs/api-reference.md`
(the `.allowEmpty()` row goes), `docs/core-concepts.md` (:269 calls `.allowEmpty()` "hypothetical" — it
shipped), `CHANGELOG.md`, `plans/ROADMAP.md`; this plan moves to `plans/completed/`.

## Test inventory

- `.expectEmpty()` reachable **and effective** on `SmellBuilder` — bug 0066's unmeasured item, now
  asserted rather than assumed.
- the contradiction guard with `.expectNonEmpty()` still throws after the hoist.
- `expectEmpty(side?)` rows: some-sides-declared → still reds; **all-sides-declared → passes**;
  one-side declared and that side gains a key → expires.
- `allowEmpty` is gone from the public surface (the assertion-gate census sees it).
- **Remedy-remediates** for the converted correspondence finding, per ADR-008 rule 2's behavioural
  corollary — apply the stated fix, assert the finding clears. A contains-assertion is same-derivation.
- Sabotage, per detector.

## Out of scope

The floor that consumes these declarations, and the precedence ruling that an empty **project** outranks
them — [0098](./0098-the-evidence-seam-and-the-floor.md). Preset-level declaration threading —
[0089](./0089-presets-forward-their-options.md), which exists to give presets an options-forwarding
mechanism and is the right home for it.
