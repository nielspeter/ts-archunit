# Plan 0090 — a `.warn()` that expires

**Status:** Open, not started. Filed 2026-08-04 from the v0.47.0–v0.49.0 review, which asked a fair
question about plan 0084 and got an uncomfortable answer.
**Priority:** Medium-high. It is the generic brick this project found, needed, and then solved only for
itself.
**Effort:** Medium. The mechanism is small; the design question — what makes a warning _accountable_ — is
the work.
**Blast radius:** **Published API, and a gate on the thing that hides regressions.** New surface, so
additive; but if the expiry ever _fails_ a build it becomes a gate, and
[ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6 already names "a check with a scheduled expiry"
as its own blast-radius row. That row exists in the ADR and nothing in the API implements it.

## Problem

[Plan 0084](./completed/0084-cycle-detection-that-ignores-type-only-imports.md) fixed this, for us:

> `arch/no-cycles` sat at `.warn()` for months behind a comment saying _"switch to .check() when
> beFreeOfCycles ignores import type"_. While it could not fail, it let a **new** cycle in overnight —
> plan 0082's fix added the value edge that closed one, and nothing failed, because nothing could.

The fix was `gate()` returning `{ check }`, making `.warn()` unrepresentable in our own architecture suite.
Good fix. **It does not generalise**: it is a repo-local test-harness type trick that no consumer can reuse.

And the problem is not ours. It is what every adopter does with a rule they cannot turn on yet — and
`docs/upgrading.md` actively teaches it:

> `.asSeverity('warn')` … Then ratchet.

The library ships nothing to make that ratchet visible. No expiry, no required reason, no `doctor` finding
for a long-lived warning, no way to distinguish "warning because the finding needs human judgement" (which
rule 1 permits) from "warning because we have not got round to it" (which is the state that let a cycle in
overnight). Those are different things wearing the same spelling.

## Phase 1 — decide what makes a warning accountable

The design question, and the plan is mostly this. Candidates, none obviously right:

- **An expiry date.** `.asSeverity('warn', { until: '2026-12-01' })` — after which it fails. Honest and
  brutal; the failure mode is a build that reds on a date change with no code change, which teams learn to
  extend rather than fix.
- **A required reason plus a ticket.** `.asSeverity('warn', { because: '…', tracking: 'bugs/0054' })`, with
  `doctor` reporting warnings whose tracking document no longer exists — reusing the machinery that already
  detects an exclusion naming a rule nobody declares.
- **A count ceiling.** Warn while there are ≤ N findings, fail on N+1. Catches the _regression_ case
  specifically — a new cycle arriving overnight — which is the case that actually bit us, and leaves the
  existing debt warning.
- **Reporting only.** `doctor` names every warning, its age (from git blame) and its finding count. No new
  failure mode; relies on someone reading it, which is the thing that failed for months.

**Recommendation: the count ceiling plus reporting.** It targets the measured failure — a warning accepting
something _new_ — rather than the moral failure of having debt, and it needs no dates. The expiry variant is
the one to argue about; do not ship both.

Whatever is chosen, `.warn()`'s current meaning must not change silently. This is additive surface, and the
existing spelling keeps working.

## Phase 2 — distinguish the two kinds of warning

ADR-008 rule 1 permits a warning for _"a finding the reader must judge"_. It forbids one for an actionable
finding. Nothing in the API records which a given warning is, so the ADR's distinction is unenforceable and
in practice unmade.

Give it a spelling. `advisory()` vs `deferred()`, or one method with a discriminated reason. Then:

- an **advisory** warning is permanent and needs no expiry — it is doing its job;
- a **deferred** warning is debt and gets whatever Phase 1 chose.

This is the part that turns the ADR row into API rather than prose.

## Phase 3 — dogfood by deletion

The proof is removing our own local mechanism. `gate()` returning `{ check }` should become unnecessary:
express the same constraint through the shipped API, and delete the trick. If it cannot be expressed, the
API is wrong and Phase 1 has to be revisited — that is the test, and it is worth more than any assertion.

Note what `gate()` gets right and must be preserved: it fails through **two independent channels** (a
typecheck error and a runtime error). A shipped equivalent has only the runtime channel, so it needs to be
correspondingly harder to ignore.

## Test inventory

1. **A deferred warning that accepts a NEW finding fails.** The measured failure from plan 0084, as a test:
   a rule with a ceiling, warning at N, failing at N+1.
2. **An advisory warning never fails**, however long it lives — or Phase 2's distinction is decoration.
3. **`doctor` reports every warning with its finding count**, by identity.
4. **`doctor` reports a warning whose tracking document has vanished**, if Phase 1 takes that branch —
   reusing the exclusion-orphan machinery rather than a second implementation.
5. **The existing `.asSeverity('warn')` and `.warn()` behave exactly as today**, so this is additive.
6. **`gate()` is deleted and our own suite still cannot reach `.warn()`.** Phase 3, and the only end-to-end
   proof.
7. **VACUITY: each row's rule really produced findings** — a ceiling test over an empty selection passes for
   the wrong reason, which is this library's own subject.

## Out of scope

- **Baselines.** A baseline records _which_ findings are accepted and is the right tool for existing debt.
  This is about the severity lever, which is used when a baseline is too much ceremony — and that is exactly
  when it goes unwatched.
- **Changing rule 1.** The ADR is right; the API is missing.

## Related

- [Plan 0084](./completed/0084-cycle-detection-that-ignores-type-only-imports.md) — solved this locally, and
  the review's fair criticism that it did not generalise.
- [ADR-008](../adr/008-agent-first-failure-surfaces.md) rules 1 and 6.
- [Bug 0024](../bugs/fixed/0024-warn-terminal-is-invisible-inside-a-test-runner.md) — made warnings visible;
  visibility turned out not to be enforcement, which is this plan's premise.
- `src/core/orphan-exclusions.ts` — the machinery Phase 1's tracking variant should reuse.
