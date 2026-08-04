# Bug 0060: changing a default pattern silently invalidated every baselined finding, and the diagnostic blamed the repo root

**Reported:** 2026-08-04 · **Fixed:** 2026-08-04 (v0.54.0) — all three filed parts; the deeper redesign is declined pending measurement, see below
**Found in:** v0.47.0, which rebuilt `STUB_PATTERNS`
([bug 0053](./0053-the-stub-rule-matched-prose-about-stubs.md)).
**Severity:** **High.** An undocumented baseline break on a rule that ships at `error` in
`agentGuardrails`, and the tool's own explanation of it names the wrong cause with confidence.

## What

`hashViolation` hashes `rule` unconditionally. A rule's description for this family embeds the pattern:

```ts
;`comment matching ${String(pattern)}`
```

and `noStubComments(pattern = STUB_PATTERNS)` defaults to it. v0.47.0 changed `STUB_PATTERNS` from a
~90-character case-insensitive regex to a ~200-character anchored one — so **every** baselined stub
finding's hash changed.

Measured, following the documented upgrade recipe (baseline on the old version, then upgrade):

```
findings BEFORE upgrade (0.46.1 pattern):   4
findings AFTER  upgrade (0.47+ pattern):    2
still reported after applying the baseline: 3
```

Zero of four entries matched. The v0.47.0 upgrading row mentions baselines only for cycles.

## Corrected mechanism — the identity embeds the pattern, not only the rule

Reviewed before implementing, and the report named the wrong path. It said the _rule description_ embeds
`String(pattern)` and `hashViolation` hashes `rule`. True, but not the operative route.

`identifyMatches` (`src/conditions/match-identity.ts`) builds the identity as:

```
kind::filePath::elementName::matcherDescription#ordinal
```

and `matcherDescription` for `comment(STUB_PATTERNS)` **is** `comment matching /…200 characters…/`. So the
**identity itself** carries the pattern text. Setting an identity — the obvious fix, and the one the
v0.49.2 review suggested — does not help, because the identity is already where the problem lives.

That reframes the fix and makes it harder, which is why it is being recorded rather than guessed at.

## Why the obvious fixes are not obviously right

`matcherDescription` is in the identity deliberately: _"Distinguishes co-located matches of different
matchers"_ — two matchers hitting the same node in one rule would otherwise share an identity, and sharing
means accepting one accepts both. The whole scheme was **measured 1:1 over 596 matched nodes in an 808-file
project** and is documented as strictly better than the line it replaced. It is not loose work to be
casually rewritten.

The options, with what each costs:

| Option                                              | Cost                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Hash the description                                | Moves whenever the pattern moves — same bug, obfuscated                                              |
| Use the matcher's **kind** (`comment`) not its text | Two `comment()` matchers with different patterns in one rule collide unless they hit different nodes |
| Index the matcher within the rule                   | Stable under pattern edits, moves when matchers are **reordered** — trades one churn for another     |
| Drop the pattern from the _description_ too         | The description is user-visible output; changes what a finding reads like                            |

**No free option.** Each trades one instability for another, and the right answer needs the same kind of
measurement the current scheme got: how often do two matchers of one family co-locate in real rule sets?
Until that exists, a change here is a guess dressed as a fix.

## The diagnostic is the worse half

```
Baseline … matched 0 of its 4 entries against 2 finding(s) in this run, so every one of them is
being reported as new. Same identity format, so the likely cause is that it was generated against
a different repository root — see the `root` option…
```

That branch exists for a real hazard, and here it fires on a different one: an **input** to the hash
moved, `HASH_VERSION` correctly did not (the _format_ is unchanged), and the message asserts a cause it
has not checked. The reader spends an hour on `root`, then regenerates — which is precisely the outcome
`docs/upgrading.md` exists to prevent, since regenerating after the jump accepts every new finding
silently.

## Why this is general, not a stub problem

Any condition whose description interpolates a value has this property. `String(pattern)` appears in
`src/conditions/function.ts` and `src/conditions/members.ts` too. So **changing any shipped default
regex is a baseline break**, and nothing in the release process surfaces that.

That is the actual defect: not that v0.47.0 broke baselines, but that it broke them _without anyone
knowing_, because no derivation connects "a default pattern changed" to "baselines move".

## Fix

Three parts, and the third is the one that matters:

1. **Document it** in the v0.47.0 row: baselined `noStubComments` findings must be regenerated.
2. **Fix the diagnostic.** "Same identity format" is not evidence for the root cause. When 0 of N match
   and the rule _descriptions_ differ between the baseline entry and the current run, say that — the
   baseline file stores enough to tell. Do not assert a cause that has not been distinguished from its
   alternatives.
3. **Make the class detectable.** A guard that fails when a shipped default pattern's `String()` form
   changes, so the release notes cannot omit it. Note this is the _pragmatic_ half: it does not stop the
   hashes moving, it stops them moving **silently**, which is the part that cost an hour of `root`-chasing.
   Given the table above, it may be the whole of the sensible fix. That is cheap — a snapshot of the _derived rule
   descriptions_ for the shipped presets — and it is the only part that stops this recurring. Note the
   tension with ADR-008's "no snapshot pins": the pin here is not a substitute for a behavioural
   assertion, it is a _change detector_ whose only job is to force a changelog entry. Say so where it
   lives.

Consider also whether the pattern belongs in the description at all: `comment matching a stub marker`
identifies the rule as well and does not move when the regex is tuned. That is the deeper fix, and it is
its own decision because the description is user-visible.

## Test inventory

1. **A baseline generated with pattern A does not match findings from pattern B** — the row that pins the
   mechanism, so nobody "fixes" it by accident.
2. **The diagnostic names a description change** when that is what happened, and does **not** mention the
   repository root.
3. **The diagnostic still names the root** when the root really is the cause — the discrimination.
4. **The shipped preset rule descriptions are stable across a release**, failing loudly when one changes.
5. **VACUITY: the baseline really contained entries** — a 0-of-0 match is not the case under test.

## Related

- [Bug 0053](./0053-the-stub-rule-matched-prose-about-stubs.md) — the pattern change that caused it.
- [Bug 0028](./0028-two-findings-in-one-file-can-share-a-baseline-identity.md) — the last time
  baseline identity was the subject; `HASH_VERSION` exists because of it.
- `src/helpers/baseline.ts`, `src/helpers/matchers.ts`.

## Fix as shipped — all three parts, and one declined

**1. Documented.** `docs/upgrading.md`'s 0.47.0 row now says to regenerate any baseline containing
`noStubComments` findings, and says why the tool could not tell you.

**2. The diagnostic no longer asserts an unchecked cause.** It said _"Same identity format, so the likely
cause is that it was generated against a different repository root"_ — one candidate among several, with
none checked. It now names the candidates in order of likelihood, puts **upgrading** first because that is
when this happens, points at the CHANGELOG, and says plainly that it cannot tell which. The `root` is still
offered, as a candidate rather than a verdict.

The existing rename detector cannot cover this case and it is worth recording why: when a pattern changes,
the rule description **and** the subject move together, so `hashSubject` misses, `recordedRule` is
`undefined`, and that diagnostic stays silent.

**3. The class is detectable.** `tests/helpers/pattern-change-moves-baselines.test.ts` fails when a shipped
default pattern's `String()` form changes, with a remedy naming all three follow-ups (update the string, add
the CHANGELOG entry, add the upgrading row). Verified by changing the pattern: it fires and prints the
remedy.

That file states what it is — a **change detector**, not a behavioural assertion. It stands in for nothing:
`tests/conditions/stubs.test.ts` asserts what the pattern _matches_ in sixteen identity-based rows. Its only
job is to make the release note impossible to forget, which is the part that cost an hour of `root`-chasing.

**Declined: removing the pattern from the identity.** The report's corrected mechanism section has the
options table, and every one trades one instability for another. `matcherDescription` is in the identity
deliberately — it separates co-located matches of different matchers — and the scheme was measured 1:1 over
596 nodes in an 808-file project. Changing it needs its own measurement: how often do two matchers of one
family co-locate in real rule sets? Until that exists, a change there is a guess dressed as a fix.

## What reviewing this report before implementing it changed

The report named the wrong mechanism. It said the _rule description_ embeds `String(pattern)` and
`hashViolation` hashes the rule — true, but not the operative route. `identifyMatches` puts
`matcherDescription` **into the identity**, and that description _is_ the pattern. So the fix the v0.49.2
review suggested — "set an identity on comment findings" — would not have worked, because the identity is
where the problem already lives. That is now pinned by a test row, after my first attempt at it was a
tautology (`` `comment matching ${p}` `` contains `p`) which I caught reviewing my own file.

## Two things the post-release review of this fix found

**1. The new diagnostic was a 688-character unbroken paragraph.** Correct — the string concatenation had no
missing spaces — and unreadable, with `(1)(2)(3)` inline. The sibling diagnostic in the same file already
uses newlines for exactly this reason. Now line-broken and indented, so the candidates are scannable.

**2. The change detector's population was a hand-maintained belief.** It asserted
`toEqual(['STUB_PATTERNS'])` — my list, checked against my list. That is the shape plan 0079 exists to
reject: a second shipped default arriving is invisible to it.

Now **derived from source**: a `RegExp`-typed parameter with a default, which is what makes a user's rule
inherit a pattern without naming it. Verified by adding a plausible second one
(`noTempNames(pattern: RegExp = TEMP_PATTERNS)`) — the derivation reports it and the row reds, where the
hand-written list would have stayed green. Plus a vacuity row, because comparing two sets passes when both
are empty, and a broken regex agrees perfectly with an empty list.

## Sabotage

| Revert                                           | Result                                                |
| ------------------------------------------------ | ----------------------------------------------------- |
| Add a marker to `STUB_PATTERNS`                  | CAUGHT — the change detector, with its remedy printed |
| Diagnostic back to asserting the repository root | CAUGHT — the updated `baseline-compat` row            |
| Drop the shipped-defaults list to `[]`           | CAUGHT — the non-vacuity row on the list itself       |
