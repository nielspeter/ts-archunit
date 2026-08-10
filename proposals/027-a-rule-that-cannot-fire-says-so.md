# Proposal 027 — A Rule That Cannot Fire Says So

**Status:** Proposed.
**Priority:** High — this is the mechanical half of
[bug 0077](../bugs/0077-a-non-empty-examined-count-proves-neither-falsifiability-nor-scope.md)A, which
is today filed as review-enforced residue. Every guard we own is green on the failure it describes.
**Affects:** `smells.inconsistentSiblings` only. `correspondence` and `crossLayer` were measured and
excluded (see §"The honesty line"). One new configuration-finding cause; no new public API.
**Blast radius:** changes `check()` for rules that pass today → published-API-surface row of
ADR-008 rule 6, with a diagnose-first migration (report on N, fail on N+1) per rule 1's corollary.
**Related:** [ADR-009](../adr/009-a-pass-is-constructed-from-evidence.md) (whose evidence standard this
extends), [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 1 and rule 2,
[plan 0099](../plans/completed/0099-the-floor-no-family-can-be-born-below.md) (the floor this sits one
level above), [proposal 026](./026-sabotage-is-a-command-not-a-ritual.md) (the other half — 026
mechanises _checking_ falsifiability, this mechanises _reporting_ it). 027's regression guard
("deleting `validateOverrides` still reds") is itself a 026-shaped sabotage; 026 first mechanises that
guard, 027 first leaves it hand-run.
**Evidence:** measured 2026-08-09 while writing `tests/archunit/dogfood.test.ts` (the
`examined: 11 / violations: 0` case); re-measured 2026-08-10 against the `correspondence` and
`crossLayer` source to test the staging claim, which did not survive (see §"The honesty line").

> **`examined: 11`, `violations: 0`, and no possible corpus makes it fail.** The floor asks whether a
> rule examined anything. It did — everything in the folder. What it could never do is produce a
> finding, and the rule had already computed the number that proves it.

## Problem

### 1. The measurement

```ts
smells.inconsistentSiblings(p).inFolder('**/src/builders/**').forPattern(call('copy'))
// examined: 11   violations: 0
```

`inconsistentSiblings` reports a **minority diverging from its siblings** — its own message is
`"5 of 7 files in <dir> use call to 'X'"`. Only 4 of the 11 builders call `copy()`, so there is no
majority for anyone to diverge from, and the rule is structurally incapable of a finding.

Every mechanical guard passes it:

| Guard              | Verdict                                            |
| ------------------ | -------------------------------------------------- |
| The floor (0099)   | passes — `examined` is 11, not 0                   |
| The vacuity matrix | passes — the cell reports a finding when it should |
| The compiler       | passes — evidence present, sited at the right seam |
| `diagnose()`       | silent — the glob is alive and matches 11 files    |

It shipped green in a test file whose entire subject is that green must mean something, and was found
only because someone asked which corpus edit would turn it red.

### 2. The rule already knows (for this corpus, as it stands)

This is what makes it worth doing rather than filing as residue. `inconsistentSiblings` computes the
majority/minority split to build its message. At the moment it decides "no minority to report", it is
holding the two numbers that prove it could not have reported anything **for the corpus exactly as it
stands**: **4 of 11 hold the pattern, so no file can diverge from a majority that does not exist.**

The qualifier matters and is kept honest below: "no majority" is impossibility for the corpus _as it
is_, not under a one-unit edit. A 2-of-4 folder crosses the 0.6 threshold in one flip; the 4-of-11
case satisfies both readings only because you would need 7 of 11. The finding reports the former —
structural impossibility given the current corpus — which is the question the predicate actually
answers. The stronger "no possible single-unit edit" reading is open question #1, and the measurement
says it is the weaker one.

The information is present, at the right seam, at the right time. It is discarded.

### 3. The user-facing cost

An author writing that rule gets silence, and reads silence as "my builders are consistent". They are
not — the rule never asked. This is the 0.18.0-era failure mode ("the tool failed open") displaced one
level: not _"the selector matched nothing"_ but _"the selector matched everything and the condition
cannot speak"_.

## The honesty line — the staging claim was measured and did not survive

**Measured (2026-08-09):** the `examined: 11 / violations: 0` case and the 4-of-11 split; that all four
guards above pass it; that `inconsistentSiblings` computes the split it would need. This is the whole
argument for the one family the proposal now claims.

**Measured (2026-08-10) and retracted:** the original draft staged `correspondence` and `crossLayer` as
families that "comparably cheaply know they are inert." Read against their source, neither does. The
distinction that matters is the emit predicate's **shape**:

- `inconsistentSiblings` emits on a **threshold over counts** it must compute for its own message —
  `matching/total >= 0.6 AND nonMatching > 0`. A threshold has an inert region: a corpus can sit in it
  such that no file the rule examined can produce a finding. That is the property this proposal
  mechanises.
- `correspondence` and `crossLayer.haveMatchingCounterpart` emit on a **set-membership test** —
  `missing = A \ B`. A subset test has no inert region: it is falsifiable by one insertion, always, on
  any non-empty corpus. "Silent today" is mere absence, not impossibility, and the proposal's
  false-positive risk exists precisely because of this shape.

The original draft's `correspondence` guess was backwards: it claimed "two sides that share no key
namespace can never be incomplete." `missing = A \ B`, so no overlap means `missing = all of A` — the
rule fires maximally. What makes it silent is total overlap, which is the one-edit-falsifiable case.
The cost model was fine (both side key-maps are fully materialized at the decision point), but no
set-theoretic property of two non-empty key sets distinguishes "cannot fire" from "does not fire
today." Its genuinely inert shapes — no sides, no assertion, an empty side — are already louder
findings (`assertsSomething()`, `emptyViolation()`, `declaresEmpty()`).

`crossLayer` splits three ways and none yields a family-level finding:

- `haveMatchingCounterpart` — same subset test as `correspondence`; mere absence.
- `satisfyPairCondition` — an opaque user callback returning `ArchViolation | null`; falsifiability is
  not inspectable. Already named as residue in the non-goals.
- `haveConsistentExports` — the one place a real structural signal exists (if `extractLeft` returns
  `[]` for every pair, no right-file edit can fire). But the count is **not held**: the code keeps no
  running total of extracted left symbols, so the "the rule already knows" story fails — it would need
  a new accumulator, per-pair with no aggregate fold. And the hook lands on `PairCondition`, a
  user-implementable interface, which is new public API and re-opens the enumeration problem the floor
  exists to close.

The staging clause — "if it is not cheaply detectable, they stay out and the proposal is still worth
its cost" — is the outcome the code supports. The proposal claims one family, measured.

## Design

A new configuration finding raised **by the family inside `detect()`**, not a new cause for the
floor's finding. The floor (`terminal-builder.ts:385`) fires only when `violations === 0 && examined
=== 0`; the 4-of-11 case has `examined = 11`, so the floor never sees it. The finding is raised after
`detect()`'s per-folder loop, when the family has computed the split and can see that no folder held a
majority. This is the established pattern for findings a family discovers while doing its work —
`correspondence-builder.ts:572,601,626` and `cross-layer.ts:128,167` raise `bypassFilters: true`
findings inside their own `collectViolations`/`evaluate`, after family logic runs. The assertion gate
(`assertsSomething`/`assertionAdvice`) is reserved for findings that make `detect()` meaningless (no
assertion, no pattern); the inert finding needs the split `detect()` computes, so it sits there.

The same inversion plan 0099 chose, and for the same reason: the root cannot enumerate what "inert"
means per family, and any list it holds will be missing the next one.

```
This rule examined 11 sibling files, but its pattern is held by 4 of them. It reports a
file that diverges from what its siblings do, so with no majority present it cannot
produce a finding as written today. Either widen the folder so a majority forms, or
choose a pattern the siblings already share. This finding cannot be suppressed …
```

The message names only the counts the family already computed for its own per-folder message. It does
**not** bake in a positive example from another folder: `detect()` iterates folders and emits
per-folder, so it has no corpus-wide "a folder where a majority exists" to suggest, and hardcoding one
project's internals into a stranger's CI output is a product defect. The remedy ends at "choose a
pattern the siblings already share" and lets the author find one; an earlier draft named
`validateOverrides` in `src/presets`, which is this project's corpus, not the reader's.

Three properties it must have, each from an existing standard:

- **`bypassFilters: true`** — it reports that the rule enforces nothing, which is not a severity the
  author gets to grade (ADR-008 rule 1, and the class `checkAll` already dedupes).
- **A remedy verified to remediate** (rule 2). "Widen the folder" and "choose a shared pattern" are
  both checkable by applying them — the second is exactly the edit that turned the dogfood rule from
  worthless to sabotage-CAUGHT.
- **Per-family, opt-in by implementation.** A family that cannot cheaply answer "could I have fired?"
  answers nothing and is unchanged. Silence is the default; this adds no cost to families that do not
  implement it. The measurement above is the reason only `inconsistentSiblings` implements it.

No staging: the proposal claims one family. A second family is added only when a threshold-predicate
emit is found that holds its counts already — not by porting the hook onto set-membership families,
which is the shape the false-positive risk forbids.

## Why it fits

- It converts bug 0077A from _"review-enforced residue"_ into a mechanical answer **for the cases where
  the rule already holds the evidence** — which is the only honest scope for it. Falsifiability in
  general is a property of semantics against a corpus and cannot be typed; falsifiability of _this
  detector, on this corpus, right now_ is a number it already has.
- It follows the floor's own ruling: ask the builder, do not enumerate at the root. The four vacuity
  waves before 0099 each closed an enumeration and were followed by a family outside it.
- It is the shape of the findings that already work. Three configuration findings caught API misuse in
  a single session — `inFolder('src')` matching nothing, a patternless detector, a boundary glob
  needing `**/` — each naming the exact fix. This adds a fourth to that family.

## Non-goals / risks

- **Not general falsifiability.** No claim is made about rule families that cannot cheaply self-assess,
  and none about user-written conditions via `defineCondition` — already named as residue in ADR-009
  part 1. `crossLayer.satisfyPairCondition` is in this class.
- **Not a replacement for sabotage.** [Proposal 026](./026-sabotage-is-a-command-not-a-ritual.md) is
  the general method; this catches one species at runtime, cheaply, before anyone thinks to sabotage.
- **Set-membership families are out, measured.** The false-positive risk — a rule that _could_ fire on
  a corpus that merely does not today — is not a hazard the design survives; it is the reason
  `correspondence` and `crossLayer.haveMatchingCounterpart` are excluded. Their emit predicate is a
  subset test, falsifiable by one insertion always; "silent today" is mere absence. Only a
  **threshold** predicate over held counts has an inert region, and `inconsistentSiblings` is the
  family that has one. This is the line the
  [bug 0076](../bugs/0076-duplicate-body-similarity-erases-identifiers-so-every-wither-pairs.md)
  detector crossed to become noise; the measurement above keeps 027 on the near side of it.
- **Partial inertness is out of scope.** `detect()` evaluates the majority/minority split **per
  folder**. A rule that fires in some folders and is inert in others reports nothing — the finding is
  corpus-level only, raised when **no** folder held a majority. A folder-level "this folder is inert"
  finding is a different species and is not claimed here.
- **It changes `check()` behaviour** for rules that pass today, so it is a minor release with an
  upgrading row, on the 0.59.0 pattern.

## Acceptance

- The measured case fails, with the numbers in the message: `smells.inconsistentSiblings(p)
.inFolder('**/src/builders/**').forPattern(call('copy'))` reports the finding rather than passing.
- The replacement rule that **can** fire — `forPattern(call('validateOverrides'))` over `src/presets`,
  with `index.ts` and `shared.ts` ignored — stays green.
- Deleting `validateOverrides` from one preset still turns that rule red (the existing sabotage must
  not be masked by the new finding).
- **The fold:** the finding is raised iff `examined > 0 && violations.length === 0 && !anyFolderHadMajority`.
  A mixed-folder corpus — where some folders have a majority and others do not — does **not** raise the
  inert finding, because the rule _can_ fire. A test spans `inFolder('**/src/**')` across a folder with
  a majority and a folder without, asserts no inert finding, and the real violation still fires.
- **Both remedies are verified.** "Choose a shared pattern" (the `validateOverrides` replacement,
  above) clears the inert finding. "Widen the folder" — a rule inert at `inFolder('**/src/builders/**')`
  widened to `inFolder('**/src/**')` so a majority forms — also clears the inert finding and produces
  real violations.
- The finding has a distinct `identity` for `checkAll` dedup —
  `inconsistent-siblings-inert::${patternDesc}` — separate from the per-file `inconsistent-sibling::`
  identity, so an inert finding and real findings never collide.
- A vacuity-matrix row for the new cause, and the finding is `error` under `.warn()`.

## Migration

This turns a rule that is green today (examined 11, violations 0) red on upgrade. ADR-008 rule 1's
migration corollary — the one ADR-009 cites for its own migration — mandates diagnostic-first: the
finding reports through `diagnose()`/`doctor` on release N, then fails on N+1. A warning is something
you hope is read; a command is something someone ran, and `warn` is invisible in a test run (bug
0024). The proposal follows that pattern: **diagnose-first on N, fail on N+1.** The "minor release
with an upgrading row" in an earlier draft was the _flip_, not the _preview_; the project's own
corollary requires the preview.

### The no-majority escape hatch

A team mid-migration may want a forward-looking rule — catch divergence _once a majority forms_ — over
a corpus where no majority exists yet. The finding is technically correct ("inert now"), but both
offered remedies may be wrong for them: the folder is the scope they want, the pattern is the one they
care about, and their only recourse today is disabling the rule entirely — the trained-suppression
dynamic ADR-008 rule 1 exists to prevent. This is a real limitation and is not solved by a suppression
comment (`bypassFilters` findings are unsuppressable by design). The honest answer is that this intent
is better served by a different rule shape — `correspondence` or a custom condition that asserts the
positive fact ("every builder calls `copy`") rather than waiting for a majority to form and then
policing divergence from it. The proposal does **not** add a declaration escape hatch (that would be
new public API, contra the "no new public API" claim, and would let an inert rule opt out of being
called inert). The limitation is documented; the remedy for the forward-looking intent is a different
rule.

## Open questions for review

1. **Is "no majority" the right predicate, or "no possible single-file edit produces a finding"?** The
   measurement settled that the cheap predicate answers the weaker question — impossibility for the
   corpus as it stands, not under a one-unit edit. The 4-of-11 case satisfies both readings; a 2-of-4
   folder would satisfy only the weaker one, and for 2-of-4 the fitting remedy is "one more file
   adopting the pattern" or "lower the threshold," not the two remedies the message names. The
   proposal claims the weaker, because that is what the predicate proves; the message remedies fit the
   4-of-11 shape. Review should confirm either that the weaker scope is worth a finding, or that the
   predicate should be narrowed to exclude one-edit-falsifiable cases (which drops the 2-of-4 case and
   its mismatched remedy with it).
2. ~~Does this belong to the family or to `SmellBuilder`?~~ **Closed by measurement.** No second family
   shares the threshold-over-held-counts shape, so there is nothing to share with. A per-family answer
   inside `inconsistentSiblings` is correct, and the "designing a hook from one instance" trap ADR-009's
   Context table documents four times does not apply — there is one instance by measurement, not by
   assumption.
3. **Severity.** ~~Rule 1 says a finding the reader must judge should warn.~~ **Closed.** `bypassFilters:
true` → `error` via `severityFor` (`violation.ts:175`), same as the floor. "Your rule cannot fire" is
   not optional; it is the same class as "your rule examined nothing." A `.warn()`-level inert finding is
   invisible in a test run (bug 0024) and trains suppression. The migration above uses diagnose-first,
   not `warn()`, to give the reader a preview.
