# Plan 0105 — The Inert Finding, Flipped

**Status:** READY. Filed per [plan 0102](./0102-a-detector-that-cannot-fire-says-so.md)'s own Release
section requirement: _"Before N ships, file the N+1 flip as its own tracked plan ... so the flip is a
scheduled deliverable with an owner and a landing point — not a property of this plan's prose."_ This is
that filing. `INERT_FINDING_EMIT`'s code comment in `src/smells/inconsistent-siblings.ts` and plan 0102's
own header both now cite this plan number.
**Fixes:** completes [bug 0077(A)](../bugs/0077-a-non-empty-examined-count-proves-neither-falsifiability-nor-scope.md).
Plan 0102 (N) made the case previewable through `diagnose()` / `inertAdvice()` / `ts-archunit doctor`
without failing `check()`. This plan (N+1) makes `check()` fail on it, which is the actual fix — N alone
is notice, not remedy.
**Depends on:** plan 0102 must have **shipped as a release** — installable, with `inertAdvice()` and the
`'inert'` diagnostic kind live — before this flips. Not a fixed number of intervening releases: ADR-008
rule 1's diagnostic-first migration makes the N release itself the notice period (a command someone runs,
not a warning nobody reads), and this plan is the scheduled next step once that notice has had a real
chance to be read — not an immediate follow-up commit in the same release.
**Priority:** High — same lineage as plan 0102, and the reason bug 0077(A) is filed High: the case this
closes is this project's own dogfood corpus's worked example of "every mechanical guard is green and the
rule is worth nothing."
**Effort:** Low. The mechanism is a one-line constant flip
(`INERT_FINDING_EMIT = false` → `true`) plus the single test plan 0102 explicitly deferred here: _"The
N+1 test (`check()` fails with the identical string `diagnose()` previewed on N) cannot be written until
that PR exists; it belongs to that PR's own test inventory, not to this one's."_
**Blast radius:** **Published API surface — small adoptership.** Identical reasoning to plan 0102's own
Blast radius paragraph, not re-derived: `smells.inconsistentSiblings` is a public export with **no preset
conduit** (only `duplicateBodies` reaches presets), so by ADR-008 rule 6 the depth is guard the
construction + one sabotage round. This flip is where the actual behaviour change lands — a rule that
passed on the N release starts failing `check()` — so the migration-corollary guard (below) matters more
here than it did in N, where nothing could yet fail.

---

## Problem

Plan 0102 shipped `INERT_FINDING_EMIT = false`: `inertAdvice()` and `diagnose()` report the truth about a
structurally-inert `inconsistentSiblings` rule, but `detect()`'s emit stays gated off, so `check()` still
passes. That is deliberate and stated in plan 0102's Release section — a diagnose-first release is the
notice, not the fix — but a gate that never flips is the same "permanent, trained suppression" shape this
project designed `.expectEmpty()` against. This plan is the flip: `INERT_FINDING_EMIT = true`, so
`detect()` actually reports the finding and `check()` fails on the population `diagnose()` already named.

## The work

### Phase 1 — flip the gate

`src/smells/inconsistent-siblings.ts`:

```ts
/**
 * 0102 shipped this false (diagnose previews, check passes) — a diagnostic-first
 * migration per ADR-008 rule 1. 0105 flips it true: check() now fails on a rule
 * that examines a real corpus but cannot fire. Not a warn-first migration — a
 * warning is invisible in a test run (bug 0024) and trains suppression.
 */
const INERT_FINDING_EMIT = true
```

No other line in `detect()`, `inertAdviceFor()`, `inertAssessment()`, or `inertEmitEnabled()` changes —
the guard, the message, and the emit gate were all built in plan 0102 to share one derivation for exactly
this reason, so flipping the constant is the entire runtime change.

### Phase 2 — the N+1 test

The regression test plan 0102 named but explicitly deferred to this plan. Use the same measured fixture
plan 0102's own test inventory already established (`tests/fixtures/smells/inconsistent-siblings/mixed-beta/`,
1-of-5 files calling `this.normalize()`):

```ts
it('the flip: check() now fails with the identical string diagnose() previewed on N', () => {
  const builder = smells
    .inconsistentSiblings(mp)
    .inFolder('**/mixed-beta/**')
    .minLines(1)
    .forPattern(call('this.normalize'))

  const preview = builder.inertAdvice()
  expect(preview).not.toBe('')

  try {
    builder.check()
    expect.fail('Expected ArchRuleError')
  } catch (err: unknown) {
    expect(err).toBeInstanceOf(ArchRuleError)
    const archErr = err as ArchRuleError
    expect(archErr.violations[0]!.message).toBe(preview)
    expect(archErr.violations[0]!.bypassFilters).toBe(true)
  }
})
```

Asserting the failure message is **byte-identical** to the N-phase `inertAdvice()` preview is the point —
it is the mechanical proof that the preview a user read on the N release is exactly what bites them on
N+1, not a differently-worded surprise.

### Phase 3 — the N-phase regression tests still hold

Plan 0102's C1 regression test (`'a healthy control (majority present) reports no advice'`) and the
`canFireSoon` boundary test must still pass unchanged: the flip only changes `inertEmitEnabled()`'s
`INERT_FINDING_EMIT` operand, not `inertAdviceFor()`'s guard (`a.matching === 0 || a.canFireSoon`), so a
rule that can still fire soon stays silent at N+1 exactly as it was at N. No new test needed here — the
existing suite is the guard; this phase is a checkpoint, not new code.

### Phase 4 — sabotage matrix

| #   | Sabotage                                                        | Expected                                                                                                                                                               |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Revert `INERT_FINDING_EMIT` to `false`                          | Phase 2's new test fails (`.check()` no longer throws) — CAUGHT                                                                                                        |
| 2   | Delete the `advice !== ''` guard in `detect()`'s emit condition | Plan 0102's healthy-control regression test fails (a `canFireSoon` rule starts emitting) — CAUGHT                                                                      |
| 3   | Delete `inertEmitEnabled()`'s `!this.declaresEmpty()` clause    | No test in this plan's own inventory catches this — inherited from plan 0102 unchanged and out of this plan's scope; flagged here rather than silently assumed covered |

Row 3 is intentionally left open rather than padded with a test written to make the row read CAUGHT: it is
plan 0102's guard, not this plan's, and closing it here would duplicate rather than complete that plan's
own sabotage matrix.

## Files changed

| File                                         | Change                                                                                                                                                                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/smells/inconsistent-siblings.ts`        | flip `INERT_FINDING_EMIT` to `true`; update its doc comment (Phase 1)                                                                                                                                                                                     |
| `tests/smells/inconsistent-siblings.test.ts` | new N+1 test (Phase 2)                                                                                                                                                                                                                                    |
| `docs/upgrading.md`                          | new version row — affected population, no suppression flag, remedies in message order, rollback (`pin to the last N-series version while applying a remedy`) — content already drafted verbatim in plan 0102's Release section, pasted in at release time |
| `CHANGELOG.md`                               | entry for this release                                                                                                                                                                                                                                    |

## Test inventory

- **The flip fires.** `.check()` throws on the measured inert case (`mixed-beta`), with `bypassFilters: true`
  and a message byte-identical to the N-phase `inertAdvice()` preview (Phase 2).
- **The flip does not widen.** Plan 0102's healthy-control (`mixed-alpha`, majority present) and
  `canFireSoon` boundary tests (`repositories/` with `parseInt` 2-of-5) still pass unchanged — a rule that
  can still fire soon is not swept in by the flip.
- **Sabotage:** reverting the constant to `false` fails the new N+1 test — CAUGHT (matrix row 1, above).

## Out of scope

- **No suppression mechanism.** Same ADR-008 rule-1 choice plan 0102 already made and Out of scope already
  states: `.excluding()`, baseline, and `.asSeverity('warn')` do not apply. Not reopened here.
- **`inertEmitEnabled()`'s `declaresEmpty()` interaction** — inherited from plan 0102 unchanged; matrix row
  3 above names it rather than silently claiming coverage.
- **Timing of when this plan actually lands** is deliberately not pinned to a release number here — it is
  a real decision (how much adoption window plan 0102's diagnose-first release should get) made at the
  point this PR is opened, not predicted in advance.
