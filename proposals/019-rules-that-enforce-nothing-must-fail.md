# Proposal 019 — A Rule That Enforces Nothing Must Fail

**Status:** Draft 1
**Priority:** High — this is a false green in the core execution path, and the mechanism to fix it already shipped.
**Affects:** four `collectViolations()` paths (`src/core/rule-builder.ts`, `src/builders/slice-rule-builder.ts`, `src/graphql/resolver-rule-builder.ts`, `src/graphql/schema-rule-builder.ts`). No new API; reuses the `bypassFilters` meta-finding built in 0.18.0/0.18.1.
**Related:** [018](./018-adoptable-discovery-surface.md) covers a different defect — findings that exist but are emitted where an agent cannot receive them. This one covers findings that are never produced at all. Split deliberately: 018 needs a ratchet first, this needs none. The dogfooded regression rule once bolted on here was removed: every formulation reviewed either could not fail or reported a hand-typed measurement that did not match the printed code. Fix the four sites first; guard them once there is a rule that has been watched to fail.

> **A rule with subjects and no conditions asserts nothing, prints to stderr, and returns a pass.** It is a check that cannot fail, reported on a run that exits 0. This is [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 1 exactly, and it survived the 0.18.x work because that work fixed empty **discovery** and left empty **conditions** behind.

## Problem

Four sites detect that a rule has selected subjects but has no condition to assert
about them. Each reacts identically: `console.warn(...)` then `return []`.

| Site                                       | Message                            |
| ------------------------------------------ | ---------------------------------- |
| `src/core/rule-builder.ts:435`             | "has predicates but no conditions" |
| `src/builders/slice-rule-builder.ts:204`   | "has no conditions"                |
| `src/graphql/resolver-rule-builder.ts:144` | "has predicates but no conditions" |
| `src/graphql/schema-rule-builder.ts:162`   | "has predicates but no conditions" |

The code has already decided this is a mistake — the messages say so ("Did you
forget to add a condition after `.should()`?"). The only open question is whether a
detected mistake **fails** or **passes**, and today it passes.

Both halves of the delivery are wrong for the stated consumer:

1. **`return []` is a pass.** The rule contributes no violations, so the run is green.
2. **`console.warn` goes to stderr on a green run.** The CLI derives its exit code
   from error-severity findings only (`src/cli/commands/check.ts:62`), so an agent's
   loop terminates on `exit 0` and never reads the text. This is the same
   invisibility measured in 018 — a warning is not a quieter signal, it is no signal.

So the failure mode is: an author writes a rule, mistypes the chain (a predicate-only
method after `.should()` is the documented way to hit this), and CI reports success
forever. The rule looks present in `explain` output and in review. It enforces nothing.

**This is the defect class 0.18.1 spent five review rounds eliminating** — for empty
selectors, empty slice discovery, empty boundary discovery, and empty correspondence
sides. Every one of those now fails with a config-level meta-finding. Empty
_conditions_ is the same bug one field over, and it was not in scope then.
`src/builders/correspondence-builder.ts:257` already carries a comment conceding the
point: _"console.warn is invisible to the agent consumer (ADR-008)"_.

## Update: one implementation, not five

When this was written, the five sites lived in two unrelated class hierarchies,
so the fix meant five near-identical copies. `spike/0014-rule-census` merged
them: `TerminalBuilder` is now the single root of every builder, and the
`collectViolations()` hook is shared. The meta-finding can be emitted once, in
one place, for every builder that will ever exist.

It also composes with something that now exists. `RuleCensus.conditions` already
reports `0` for a rule that asserts nothing — the state is _observable_ and
still passes. This proposal is the half that makes it _fail_.

Worth stating the relationship plainly, since the two are easily confused:
**this proposal covers empty conditions; the 0067-C empty-selector flip covers
empty subjects.** A rule can be vacuous either way, and neither guard sees the
other's case.

All five sites are unchanged as of 0.19.0 — verified, not assumed.

## Proposal

Replace `console.warn(...) + return []` at all four sites with the meta-finding
mechanism that already exists and is already tested:

- a violation carrying `bypassFilters: true`, so it survives `.excluding()`,
  `withBaseline()` and diff-aware filtering — a rule that enforces nothing must not
  be silenceable by the tools meant for accepting real debt;
- a message that names the rule and states the fix, which the existing warning text
  already does well and can be reused nearly verbatim;
- no source location (these are configuration findings), which the 0.18.1 formatter
  change already renders correctly — the message appears in place of the useless
  `:0` line.

Nothing new is designed here. `ArchViolation.bypassFilters`, the formatter path, the
`applyFilters` exemption and the baseline refusal all shipped and have tests.

### Also in scope, same class

`src/presets/shared.ts:77` warns when an override key matches no rule in the preset.
That is a user who tried to configure or disable a rule and whose intent silently did
not apply — configuration rot with the same invisible delivery. Lower severity than
the four above because nothing is falsely certified, but it is the same fix.

### Out of scope

- **`src/helpers/diff-aware.ts:65`** — warns that `git diff` failed and _all_
  violations will be reported. That fails **safe** (reports more, not less) and
  should stay a warning.
- **Severity of real findings** — 018's territory.
- **The other 12 `console.warn` sites**, which are diagnostics about matchers and
  exclusions rather than claims that a rule is enforcing something.

## Migration

This turns currently-green builds red — but only for rules that were never checking
anything, which is the intended outcome and cannot be a regression in coverage. The
honest framing for the CHANGELOG: _"if this fires, that rule has never enforced
anything; the build was green on a false premise."_

Blast radius is likely small and is measurable before shipping: the condition
requires a rule to reach a terminal with zero conditions, which today produces a
visible stderr warning that most projects would have noticed. **No existing test
pins the pass behaviour** — the one test touching this area
(`tests/conditions/phase-tracking.test.ts:238`) ends with a real condition and
already expects a throw.

## Alternatives considered

- **Leave it a warning, document it louder.** Rejected on measurement: the warning is
  written to stderr on a run that exits 0. There is no volume at which an unread
  channel becomes read.
- **Throw immediately at chain-construction time** rather than producing a finding.
  Tempting — it is a programming error, not an architecture violation — but it breaks
  `.violations()`-based aggregation (`checkAll`, presets), which expects to collect
  from many builders without one bad chain aborting the batch. A meta-finding
  composes with that; an exception does not.
- **Fold into 018.** Rejected: 018 cannot ship until a ratchet exists, and this needs
  no ratchet. Bundling a verified fix with work that has an unresolved design
  question is the pattern that cost 0.18.1 five review rounds.
