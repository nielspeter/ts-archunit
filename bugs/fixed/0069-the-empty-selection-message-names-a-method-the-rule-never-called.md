# Bug 0069: the empty-selection message names a method the rule never called, and tells the reader to remove it

**Reported:** 2026-08-06 · **Fixed:** 2026-08-06 (v0.58.0)
**Found in:** an unrelated measurement — probing the `within()` vacuity cell for
[plan 0095](../../plans/completed/0095-the-vacuity-matrix-and-the-conformance-audit.md). The finding fired correctly; its
first sentence was wrong. Reproduced on the published 0.57.0 dist.
**Severity:** **Medium.** Published API and every adopter meets it — this is the finding 0.34.0 made the
default fault, so it is the most-seen configuration finding in the library. It is not High because the
`Fix:` line beside it is correct and mechanical, so the reader who reads both lines is steered right.
Top row of [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 6 by blast radius, discounted by
that.

## What happens

A rule that never calls `.expectNonEmpty()` and whose selector matches nothing reports:

```
Selector matched 0 subjects, but .expectNonEmpty() requires at least one — likely a wrong glob
or filter. If an empty match is valid here, remove .expectNonEmpty().
Fix: Widen the selector until it matches at least one subject, or declare .expectEmpty() if
matching nothing is the point — that asserts it, and fails the day something does match.
```

Measured, 0.57.0 dist, on a one-file project (`scratchpad/within-probe.mjs`, cells A and B):

```ts
within(calls(p).that().onObject('logger')) //  2 calls matched, zero callbacks
  .functions()
  .should()
  .contain(call('definitelyNotCalled'))
  .check() // → the message above
```

No `.expectNonEmpty()` anywhere in the chain. The message names it twice: once as the requirement being
violated, once as the thing to remove.

**Removing it is impossible — there is nothing to remove.** Since [plan 0074](../../plans/completed/0074-r3b-the-selector-glob-flip.md)
(v0.34.0) an empty selection is a finding **by default**; `.expectNonEmpty()` became a no-op opt-in that
no longer gates anything. So the sentence describes the pre-0.34.0 world, and its instruction is
unfollowable in the current one. [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 2:
_"A message whose stated fix is impossible on the path that produced it is worse than no message: the
agent tries it, it fails, and the agent then does the forbidden thing."_

## Why this is the interesting shape, not just a stale string

**Plan 0074 diagnosed this exact defect, fixed it one field down, and left it in the field above.**
`src/core/rule-builder.ts:534-536` is the stale `message`. Immediately below it, `:538-545`, is the
comment explaining why the text had to change — attached to the `suggestion` that was changed:

```ts
message:
  'Selector matched 0 subjects, but .expectNonEmpty() requires at least one — ' +
  'likely a wrong glob or filter. If an empty match is valid here, remove .expectNonEmpty().',
because: this._reason,
// Its own remedy, and only its own. …
// The remedy changed with plan 0074. It used to say "drop
// .expectNonEmpty() if matching nothing is valid here", which stopped
// being true the moment empty became the default fault — dropping the
// opt-in now changes nothing, so an agent following it fails, and then
// improvises. ADR-008 rule 2: a remedy that is impossible on the path
// that produced it is worse than none.
suggestion:
  'Widen the selector until it matches at least one subject, or declare ' +
  '.expectEmpty() if matching nothing is the point — …',
```

The reasoning is correct, it is written down, and it applies verbatim to the three lines above it. What
0074 changed was the field it was looking at.

**And the guard inherited the same blind spot.** `tests/core/config-findings-carry-their-own-remedy.test.ts:73-79`
pins the fix — with the same rationale in a comment — against `suggestion` only:

```ts
expect(f?.suggestion).toContain('.expectEmpty()')
expect(f?.suggestion).not.toContain('drop .expectNonEmpty()')
```

Nothing asserts anything about `message`. Ask ADR-008 rule 5's question of that test — _what would it do
if the thing it guards were completely broken?_ — and the answer is that it passes today, with the
identical defect shipping in the sentence the reader sees **first**. Two tests do assert the message and
both truncate before the defect (`dead-selector-fails.test.ts:368,381` and
`config-findings-cannot-be-downgraded.test.ts:192` all stop at `'Selector matched 0 subjects'`), which is
why no suite noticed.

Introduced in `a73046b` (2026-07-24, v0.18.0) — correct when written, since `.expectNonEmpty()` was then
a real opt-in gate. It went stale on 2026-08-01 when 0074 inverted the default, and the plan that
inverted it fixed the neighbouring field.

## The fix

One string, `src/core/rule-builder.ts:534-536`. State the fault without naming an uninvolved method —
the `Fix:` line already carries both remedies:

```ts
message: 'Selector matched 0 subjects, so this rule can never fail — likely a wrong glob or filter.',
```

Two guards, because one of them is the reason this shipped:

1. Extend the existing test to the field that was missed —
   `expect(f?.message).not.toContain('.expectNonEmpty()')` beside the `suggestion` assertions, so the
   pair is covered by one thought rather than two.
2. The **general** version, which is what actually prevents the next one: no configuration finding's
   `message` or `suggestion` may name an API the rule did not call. Cheap for this family
   (`.expectNonEmpty()` / `.expectEmpty()` membership is readable off the builder). Worth scoping before
   building — see Not measured.

## Blast radius on adopters

Nobody's build changes colour: the finding fires identically, and the `Fix:` line is correct. What
changes is what an agent does with the red — today the first sentence sends it looking for a call that
is not there. Ship as a patch or with any minor; no migration.

## Not measured

- Whether the other configuration-finding producers name uninvolved APIs the same way. `emptySelectionViolation`
  was found by accident; the sibling producers (empty project, dead glob, preset discovery, asserts-nothing)
  were **not** audited for this specific defect. Do that before writing the general guard in fix step 2 —
  the guard's shape depends on how many producers it has to serve, and this report has one data point.
- Whether `docs/` repeats the stale sentence anywhere. Only `src/core/rule-builder.ts:535` was grepped.
- Whether `unexpectedlyNonEmptyViolation` (`:588`, the `.expectEmpty()` expiry counterpart) has an
  equivalent staleness. Plan 0095 deletes that producer, so it may be moot — but "may be" is not
  measured, and 0095 has not shipped.

## Fix as shipped

**v0.58.0**, 2026-08-06. One string, `src/core/rule-builder.ts`:

```ts
message:
  'Selector matched 0 subjects, so this rule can never fail — ' +
  'likely a wrong glob or filter.',
```

The `Fix:` line is unchanged — it already carried both remedies reachable from any path that produces
this finding.

**No adopter identity change.** The finding sets `bypassFilters`, so no baseline ever stored it; and
`dead-selector-fails.test.ts`'s assertions split the message on its first comma, so the prefix they pin
is genuinely unchanged rather than accidentally so.

### Guard — both fields, one thought

The reason this shipped is that plan 0074's guard was written for the field being fixed. So the fix is
paired:

- the existing test gains `expect(f?.message).not.toContain('.expectNonEmpty()')` beside its
  `suggestion` assertions, so a future edit meets both in one place;
- a new test makes the **sharp** case its own row — a chain that never calls `.expectNonEmpty()`, where
  the old text named a method that was not there and told the reader to remove it. It also asserts the
  finding still states the fault and still carries a reachable remedy, so passing by saying nothing is
  not available.

### Sabotage

Restoring the old message reds **both** assertions (2 failed, 4 passed). Run inside the 5-row matrix
shared with bug 0068: green baseline first, patch asserted to apply, verdict from the exit code.
**Caught by nothing: 0 of 5.**

### Not fixed here

The general form — _no configuration finding may name an API the rule did not call_ — is deliberately
not built. This report has **one** data point, and the sibling producers (empty project, dead glob,
preset discovery, asserts-nothing) were not audited for it. The guard's shape depends on how many
producers it must serve, so auditing comes first. Plan 0098 rewrites this producer's remedy
text anyway; whoever does that should expect this string to have moved.
