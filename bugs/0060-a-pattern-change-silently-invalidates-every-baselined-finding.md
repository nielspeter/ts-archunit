# Bug 0060: changing a default pattern silently invalidated every baselined finding, and the diagnostic blamed the repo root

**Reported:** 2026-08-04 · **Fixed:** not yet
**Found in:** v0.47.0, which rebuilt `STUB_PATTERNS`
([bug 0053](./fixed/0053-the-stub-rule-matched-prose-about-stubs.md)).
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
   changes, so the release notes cannot omit it. That is cheap — a snapshot of the _derived rule
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

- [Bug 0053](./fixed/0053-the-stub-rule-matched-prose-about-stubs.md) — the pattern change that caused it.
- [Bug 0028](./fixed/0028-two-findings-in-one-file-can-share-a-baseline-identity.md) — the last time
  baseline identity was the subject; `HASH_VERSION` exists because of it.
- `src/helpers/baseline.ts`, `src/helpers/matchers.ts`.
