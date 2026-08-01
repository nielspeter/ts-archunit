# Plan 0078 — Derive the configuration-finding census

**Status:** **PARTIALLY SHIPPED.** Phase 3 (the unsuppressability sentence) landed in
**v0.37.0** — it was the user-facing part, and bug 0041 made its omission reachable from every
condition family, so it could not wait behind an internal census. Phases 1 and 2 are open and
not started. Filed 2026-08-01 from the ADR-008 compliance audit; revised the same day after
adversarial review found two structural defects and one live bug.
**Priority:** **Medium** for what remains, downgraded from High after review pointed out the
plan sequenced two user-facing bugs ahead of itself and still outranked them. The rule 2 gap is
nine sites wide and the rule 3 gap was ten — but the ten shipped, and the nine are guards rather
than defects.
**Effort:** Medium. The census is a test file; the message edits are ten strings; but the key
has to be `file:line` with a follow-through arm, which is more than the first draft assumed.
**Blast radius:** Internal check over a corpus we control, guarding **published** messages. Per
[ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6 the depth splits by artifact: the
messages get the behavioural treatment, the census itself stops at "prove each detector fires".

## Problem

Every finding carrying `bypassFilters: true` is a **configuration finding**: it reports that a
rule enforces nothing, and it is unsuppressable by construction. There are **12** such sites
across **8** files:

```
src/core/terminal-builder.ts   ×2      src/presets/shared.ts               ×1
src/core/rule-builder.ts       ×2      src/conditions/cross-layer.ts       ×1
src/helpers/baseline.ts        ×2      src/builders/slice-rule-builder.ts  ×1
src/cli/rule-file-findings.ts  ×2      src/builders/correspondence-builder.ts ×1
src/core/execute-rule.ts       ×1  (added v0.38.0, bug 0039)
```

Two invariants are supposed to hold across all twelve. Neither is enforced, and both are already
false somewhere.

### Rule 2 — the guard reaches 3 of 12, and one site is broken today

`tests/core/config-findings-carry-their-own-remedy.test.ts` enumerates **three** producers by
hand (`functions`, `slices`, `correspondence`). Its universal case (`:182`) is:

```ts
expect(f.suggestion, `${f.rule} has no remedy`).toBeTruthy()
```

Presence, not correctness. A remedy that reads well and does not work passes it forever —
[bug 0017](../bugs/fixed/0017-boundaries-no-cross-boundary-message-overclaims-entry-point-enforcement.md)
exactly.

`tests/presets/shared.test.ts:118` asserts the same invariant for presets, but its fixtures make
discovery **succeed**, so `assertDiscovered` returns `[]` and `shared.ts:71` is never reached:
`grep -rn "Discovery matched 0\|assertDiscovered" tests/` → **zero hits**.

**Eleven of twelve carry a `suggestion`, not twelve.** `cross-layer.ts:52` sets
`suggestion: context.suggestion`, which is optional, so with no `.rule({...})` the finding
reaches the reader bare — and _with_ author metadata it carries the author's unrelated remedy.
That is [bug 0042](../bugs/fixed/0042-cross-layers-empty-layer-finding-inherits-the-authors-remedy.md),
filed separately, and it is the live proof of this plan's premise: a hand-written list cannot
fail when the list is what went stale.

### Rule 3 — 2 of 12 say they cannot be suppressed

Only `terminal-builder.ts:203` and `:480`. Checked for indirect inheritance and found none:
`format.ts`, `format-json.ts` and `format-github.ts` never mention the flag or the sentence;
`execute-rule.ts` mentions it only in a docstring (`:236`); `dedupe-config-findings.ts` appends
a fan-out note and nothing else. Phase 3 is necessary.

Most exposed is **`rule-builder.ts:556`** — `emptySelectionViolation`, the first configuration
finding an adopting team meets. (`:522` is `unexpectedlyNonEmptyViolation`, a different finding;
the audit's prose mislabelled it and the first draft of this plan copied the error.)

## Phase 1 — the census

A test that reads `src/`, finds every site declaring a `bypassFilters: true` finding, and fails
until each is classified. Model it on `tests/core/every-path-glob-surface-is-classified.test.ts`.

**The scan is complete, and that was checked rather than assumed.** All 43 `bypassFilters`
occurrences in `src/` are exactly one of: the literal `bypassFilters: true` (12 — the census
population), the type declaration (`violation.ts:74`), or a read. There is no computed write, no
`bypassFilters: someFlag`, no `Object.assign`, and no spread that introduces the flag — the
spreads that exist (`execute-rule.ts:161`, `terminal-builder.violations()`,
`dedupe-config-findings.ts:96`) transform findings that already carry it. The graphql builders
inherit from `TerminalBuilder` and add no producer.

**Key on `file:line`, not on file.** Four of the eight files hold **two** sites each
(`terminal-builder`, `rule-builder`, `baseline`, `rule-file-findings`). Append the sentence to
`baseline.ts:674` and not `:730`, and a file-keyed entry is a lie about half its sites.

**Second arm: follow helper-supplied remedies to their call sites.** `shared.ts:71` is
`assertDiscovered`, whose `suggestion` is `finding.remedy` — supplied by **two** callers
(`boundaries.ts:145`, `:188`) with two different texts, **neither containing the literal**. The
census sees one row; the two strings a reader actually gets are invisible to it. A third caller
— another preset, or a `@ts-archunit/*` package under ADR-006 — would add a reader-facing remedy
the census reports nothing about.

```ts
const CLASSIFIED: Readonly<Record<string, 'remedy+unsuppressable' | 'remedy-only'>> = {
  'core/terminal-builder.ts:203': 'remedy+unsuppressable',
  'core/terminal-builder.ts:480': 'remedy+unsuppressable',
  'core/rule-builder.ts:522': 'remedy-only',
  // ...
}
/** Helpers whose remedy comes from a caller; each call site is classified too. */
const REMEDY_HELPERS = ['assertDiscovered'] as const
```

Three tests, as in 0036: the census finds ≥12 sites including the known members; nothing
unclassified; nothing classified that no longer declares.

Do **not** import 0036's "exclude the mechanism itself" lesson — under the tight
`bypassFilters: true` key it does not apply (all 8 matching files are producers;
`violation.ts` does not match). Under a loose `bypassFilters` key it would need a five-entry
exclusion list, i.e. a hand-maintained list inside the census. Commit to the tight key.

**Detector proof (rule 6's floor): one row per census test, not one for the file.** Three
one-line proofs — an unclassified site, a classified site that no longer declares, a site count
below the floor — each asserted to red. Precedent is `bugs/fixed/0036…:32`, which recorded one;
three is trivial and rule 6's floor is _each_ detector.

## Phase 2 — every site carries a remedy, and the right one

`toBeTruthy()` is not enough: it passes on bug 0042, which is live today. Use the **two-direction
shape** the existing test already establishes:

```ts
expect(f.suggestion).toBeTruthy()
expect(f.suggestion).not.toBe(AUTHOR.suggestion) // never the rule author's
expect(f.ruleId).toBe(AUTHOR.id) // but still says WHICH rule
expect(f.because).toBe(AUTHOR.because)
// control: a REAL violation of the same rule inherits all four
```

Then rule 2's corollary — _a remedy is a claim, so rule 5 applies to it._ For each of the twelve
one of two things must be true, and the census records which:

- a behavioural test **applies the stated fix and asserts the finding clears**. The 13 that
  exist are the model, particularly `boundaries-folder-level.test.ts:103`, which keeps bug 0017's
  wrong remedy as a control and asserts it does _not_ remediate; or
- the remedy is a judgement, and the site is classified as such **with the reason written down**.

Do not let "it's a judgement" become the default. If more than a handful land there, the
classification is doing the work the test should.

## Phase 3 — the unsuppressability sentence — **SHIPPED v0.37.0**

Done: `src/core/unsuppressable.ts` holds the sentence once, with the sixth surface added, and
`tests/core/unsuppressable-sentence.test.ts` guards it by set comparison — behavioural probes
against the parsed names, failing on over-claim and under-claim alike. Sabotaged in both
directions plus a real refusal break: 3 of 3 caught. The original text follows, for the record.

**The sentence is itself incomplete, and this is the part the first draft got wrong.** Six
suppression surfaces are refused; the sentence names five. The omission is the inline
`// ts-archunit-exclude` comment — refused at `execute-rule.ts:128`, pinned by
`tests/core/config-findings-cannot-be-downgraded.test.ts:171` under
`describe('the fifth suppression surface')`, documented at `rule-file-findings.ts:24-26`. And
the two findings for which that surface is actually _reachable_ — `rule-file-findings.ts:85` and
`:161`, the only configuration findings carrying a real `file` path — are two of the ten sites
this phase would stamp. An agent reading "not by A, B, C, D, or E" infers exhaustiveness and
reaches for the comment. Rule 3's failure mode inside the sentence rule 3 asked for.

So: **fix the sentence, then source it from one place.** It is currently duplicated inline at
`terminal-builder.ts:188` and `:468` (prettier has already split the second copy across lines —
the hazard Phase 1's own scan lesson warns about).

**The guard is a set comparison, not a contains-check.** Derive two sets and fail on
disagreement either way:

- mechanisms that **behaviourally** refuse the flag — one probe each through `severityFor`
  (`violation.ts:170`), `applyFilters` exclusions, `execute-rule.ts:128`, `baseline.ts:338`,
  `diff-aware.ts:40`;
- mechanisms **named in the sentence**, parsed from the string.

Over-claim (names something that does not refuse — bug 0017's shape) and under-claim (refuses
but unnamed — the gap above) both fail. Runtime behaviour versus prose: independent, no second
engine, reuses tests that already exist, and costs about what the contains-check would.

This replaces the first draft's honest-but-weaker plan to ship a same-derivation check and say
so. The disclosure was correct practice; it was not the best answer available.

## Test inventory

| Test                                                             | Asserts                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| `every-config-finding-is-classified.test.ts` — census finds ≥12  | site list includes every known member                    |
| — nothing unclassified                                           | a new producer reds the suite                            |
| — nothing stale                                                  | a classified site that no longer declares reds           |
| — helper call sites                                              | every `REMEDY_HELPERS` caller is classified              |
| `config-findings-carry-their-own-remedy.test.ts` — two-direction | never the author's remedy; still carries `ruleId`        |
| — control                                                        | a real violation inherits all four                       |
| — per-site remedy                                                | non-empty at all 12                                      |
| behavioural remedy tests                                         | one per mechanical remedy: apply the fix, finding clears |
| `unsuppressability-sentence.test.ts` — set comparison            | refusing mechanisms == named mechanisms                  |

## Guards

Sabotage rows, each asserted to red, verdicts read from the **exit code**:

| Revert                                                          | Expected          |
| --------------------------------------------------------------- | ----------------- |
| Add a 13th producer with no remedy                              | red               |
| Add a 13th producer with no unsuppressability sentence          | red               |
| Remove a site from `CLASSIFIED` that still declares             | red               |
| Add a third `assertDiscovered` caller, unclassified             | red               |
| Restore `suggestion: context.suggestion` at `cross-layer.ts:52` | red               |
| Drop one mechanism from the sentence                            | red (under-claim) |
| Add a fictitious mechanism to the sentence                      | red (over-claim)  |

Enumerate the final list from `git diff`, not from this table — the table was written before the
code and rule 5's first corollary is about exactly that gap.

## Files changed

| Phase | File                                                        | Change                                       |
| ----- | ----------------------------------------------------------- | -------------------------------------------- |
| 1     | `tests/core/every-config-finding-is-classified.test.ts`     | new — the census, keyed `file:line`          |
| 2     | `tests/core/config-findings-carry-their-own-remedy.test.ts` | universal case → census; two-direction shape |
| 2     | wherever a remedy lacks a behavioural test                  | new tests, one per mechanical remedy         |
| 3     | one shared constant                                         | the corrected sentence, once                 |
| 3     | the ten sites listed above                                  | append it                                    |
| 3     | `tests/core/unsuppressability-sentence.test.ts`             | new — the set comparison                     |

Housekeeping the census makes safe to do: `src/core/execute-rule.ts:174` says "five of the six
`bypassFilters` producers" and `tests/core/config-findings-cannot-be-downgraded.test.ts:9` says
"Five producers". Both are stale hand-counts against 12.

## Out of scope

- **[Bug 0038](../bugs/0038-a-typo-in-a-preset-override-key-is-a-silent-false-green.md)** — a
  site that _should_ produce a configuration finding and does not. The census guards producers
  that exist; it structurally cannot find a missing one. Fix 0038 separately, then let the census
  pick up the new site.
- **[Bug 0042](../bugs/fixed/0042-cross-layers-empty-layer-finding-inherits-the-authors-remedy.md)** —
  fix it on its own terms; this plan only ensures nothing like it can hide again.
- **The 215 count-only test assertions** from the audit. An untriaged upper bound from a
  heuristic scan with known false positives; sample before filing.
- **Rule 6 in the plan header.** A convention change, not this plan.

## Related

- [ADR-008](../adr/008-agent-first-failure-surfaces.md) rules 2, 3, 5 and 6.
- [Bug 0036](../bugs/fixed/0036-the-relative-glob-audit-is-incomplete.md) — the same fix at the
  glob surface; its census is the template.
- [Bug 0021](../bugs/fixed/0021-a-config-finding-prints-the-rule-authors-unrelated-remedy.md) —
  why a configuration finding carries its own remedy, and the source of Phase 2's test shape.
- No overlap with open plans 0047, 0048 or 0072, or with completed 0067/0069/0070 — checked.

## Review notes (2026-08-01)

- **Priority is inverted against this plan's own text** and that is now explicit rather than
  implied. It sequences two user-facing bugs ahead of itself (0038 in Out of scope; 0040's fix
  must reuse the existing producer) and still claimed High. **Phases 1–2 are Medium**, behind 0038. Phase 3 was the user-facing part — and it **shipped in v0.37.0** ahead of the rest,
  because the sentence it fixes was reachable-but-wrong the moment 0041 landed.
- **Effort Medium was optimistic.** Phase 2 wants a behavioural apply-the-fix test per mechanical
  remedy across up to 12 sites: twelve fixtures alongside a census and ten message edits.
- **Put a numeric cap on the "it's a judgement" classification.** The plan warns against it
  becoming the default and gives that warning no teeth. A cap makes the escape hatch itself able
  to fail.
- **Census population is 13 as of v0.38.0, and was 12 when filed** — it has already moved once while this plan sat open, which is the argument for the plan — v0.37.0's disclosure work did not add a producer, but
  bug 0038's fix will, and 0040's fix should _remove_ one (the cross-layer producer becomes
  redundant once `deadSelectorViolation` covers discovery sites). Re-derive rather than trusting
  the list above.
- **Confirmed by review:** no producer emits the flag without the literal `bypassFilters: true`
  — 43 occurrences, all literal / type declaration / read. The text census is sound at the scan
  level.
