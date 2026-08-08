# Proposal 022 — A Duplication Finding Is a Group, Not a Pair

**Status:** Proposed. **Revised 2026-08-05 after architect + product review** — ask 1's shape is
changed, ask 2 is held, ask 4 is re-scoped. See "What the review changed" below before reading the asks.
**Priority:** High — at the current granularity the agent-facing contract cannot carry the **conclusion**,
which is the thing the reader needs. Measured on a bare `smells.duplicateBodies(p)`: `suggestion` is
`null` on 32 of 32 findings and `explain --format agent` emits `- unnamed`, while the CLI's own
instruction block tells the agent to _"fix each one using its `suggestion`"_.

> **Corrected after review — an earlier draft said the contract was "unfillable".** It is not. Both
> shipped presets already supply a suggestion (`src/presets/agent-guardrails.ts:140`,
> `src/presets/boundaries.ts:286`), and the boundaries text — _"raise `withMinSimilarity()` or exclude
> the pair"_ — is a pair-shaped remedy that **is** verifiable: apply it and the finding clears. The
> 32-of-32 null measures a **missing default on the bare builder**, which is a plumbing fix, not a
> structural impossibility. What a pair genuinely cannot carry is the architectural conclusion. That is
> the narrower claim, it is sufficient, and everything below rests on it.
> **Affects:** `src/smells/duplicate-bodies.ts` (reporting only — the matcher is sound and stays), and the three agent surfaces that read it (`explain --format agent`, the `--format json` payload, `.rule({ imperative })`).
> **Related:** [bug 0066](../bugs/fixed/0066-a-smell-detector-over-zero-files-passes.md) and [bug 0067](../bugs/fixed/0067-a-duplicate-pair-identity-collides-on-two-same-named-functions-in-one-file.md) (**closed in v0.57.0**) are defects in the same detector and independent of this; 0066 is still open and is cheaper than this. [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 2 is the standard this fails.
> **Evidence:** measured against `nielspeter/cmless` @ `1481446` (2,371 TS/TSX files, 19 scopes) with the published 0.56.0 package, and **re-verified unchanged at v0.57.0** — `explain --format agent` still emits `- unnamed`, `suggestion` is still null on 32 of 32, `codeFrame` on 32 of 32. Reproduce with `spikes/022-duplication-report-shape.mjs` and `spikes/022-signals-scored.mjs`. Every number below is counted, not estimated; the two claims that are **not** measured are marked.
> **Not affected by v0.57.0's identity work.** That release closed [bug 0067](../bugs/fixed/0067-a-duplicate-pair-identity-collides-on-two-same-named-functions-in-one-file.md) via `disambiguateIdentities`, which changes how findings are _keyed_, not how many there are or what they can say. The pairs-vs-groups argument is untouched by it.

> **A pair cannot carry a remedy.** `X is 92% similar to Y` states a measurement where the reader needs a conclusion, and the conclusion — _eleven queue managers implement `shutdown()` identically, there is no base class_ — does not exist until the group is assembled. The detector already has the group; it discards it at the last step and prints the edges.

## Problem

### 1. The remedy field is empty by default, and the sentence it would carry is the real problem

Measured on `packages/sdk`, **bare `smells.duplicateBodies(p)`** — no preset, no `.rule()`
(`spikes/022-duplication-report-shape.mjs:95`). Under either shipped preset `suggestion` is
populated; this table is the default-configuration case:

| field        | value                         |
| ------------ | ----------------------------- |
| `ruleId`     | `null`                        |
| `because`    | `null`                        |
| `suggestion` | `null` — **0 of 32 findings** |
| `codeFrame`  | `null`                        |
| `docs`       | `null`                        |

`explain --format agent` for the same rule emits, in full:

```
### General

- unnamed
```

Supplying `.rule({ id, because, suggestion, imperative })` populates all of it except
`codeFrame`, which stays `null` even then — so a duplication finding is the one kind that
shows the reader no source. That much is a default-and-plumbing problem, and step 1 of the
Sequence below fixes it without touching identities: `DuplicateBodiesBuilder` never overrides
`describeRule()` (hence `- unnamed`), and `buildViolations` hand-constructs its violation instead
of going through `createViolation`, the only caller of `generateCodeFrame` (hence the null frame).

**The part that metadata cannot fix is the sentence itself.** With metadata the suggestion
reads _"extract the shared logic into one function and call it from both"_ — identically on
all 32 findings, because a pair has nowhere to put _which_ function, _where_ it belongs, or
that six other repositories already contain the same body. ADR-008 rule 2's behavioural
corollary asks that a remedy be **verified to remediate**: apply the stated fix and assert
the finding clears. "Extract the shared logic" cannot be applied, so it cannot be verified.
It reads well and instructs nothing — bug 0017's shape.

### 2. The volume is a consequence of the same choice

|                                                       | measured on cmless |
| ----------------------------------------------------- | -----------------: |
| pairs reported                                        |          **1,515** |
| distinct functions involved                           |                855 |
| **groups** (union-find over the pair graph)           |            **269** |
| findings **located on** `technical-limits.service.ts` |            **153** |
| findings **involving** it (either endpoint)           |            **306** |

One file with 18 sibling guard methods accounts for **153 findings located on it** — 23% of
`apps/api`'s total — and appears as one endpoint or the other in **306**. (Both measures are
reported because they differ and the distinction is easy to blur; `spikes/022-duplication-report-shape.mjs`
derives the first.) No ranking accompanies them. The rational response to 1,515 unordered
findings is `arch:baseline`, which is ADR-008's predicted failure exactly: _"the invented
remedy is reliably the cheapest path… add a suppression."_

### 3. The conclusion the tool is for is the one it cannot state

Every one of the ten largest groups is a **missing or abandoned abstraction** — an
architectural fact, not a style smell:

| group                           | copies | the architecture it reports                                |
| ------------------------------- | -----: | ---------------------------------------------------------- |
| `QueueManager.shutdown`         |     11 | there is no `QueueManager` base class                      |
| `QueueManager.getWorker`        |      8 | same gap, second method                                    |
| `*Repository.create`            |      7 | `BaseRepository` lacks `resolveEnvironment()`              |
| `ResendEmailService.send*Email` |     13 | **`sendTemplated` already exists at `:620` and is unused** |
| `IGClient` HTTP methods         |      9 | no shared `request()` helper                               |
| CLI `register*Commands`         |      6 | no command factory                                         |

And one row that is a defect rather than a gap: `BulkAssignQueueManager.shutdown` and
`GCQueueManager.close` are byte-identical logic under **two different method names** — the
interface was never declared, so the names drifted. A pair-shaped finding reports that as
"95% similar". The group reports it as a missing interface.

A pair is not merely a noisier way to say this. **It is unable to say it**: "there is no base
class" is a statement about eleven things, and the finding only holds two.

## Proposal

Four changes. (1) is the proposal; (2)–(4) are what (1) makes possible.

### 1. Group before reporting; emit one finding **per member**

Union-find over the pair graph, which the detector already computes. **Group in the detector;
report per member; put the roster in the message.**

**Revised after review — an earlier draft proposed one finding per group, keyed on the sorted
member set. That shape is wrong, and this repository had already decided so in writing.**
`src/smells/inconsistent-siblings.ts:88-93`, in the sibling detector this proposal lists as out
of scope:

> _"The message states the population ('3 of 5'), which is a fact about the folder rather than
> about this file: adding one unrelated sibling rewrites it, and every already-accepted finding
> in the folder loses its identity. The finding itself is 'this file, in this folder, does not
> follow this pattern' — that, and only that, is the identity."_

It computes a group and emits one finding per member for exactly the reason the earlier draft
ignored. **Grouping is a rendering decision; identity is a durability decision.** This proposal
needs the first and was buying the second by accident.

What a membership-keyed identity costs, which the earlier draft recorded as a one-time
migration and is not:

| edit to a baselined group    | per pair (today) | per group (rejected)                   | per member (proposed) |
| ---------------------------- | ---------------- | -------------------------------------- | --------------------- |
| add a copy                   | n new entries    | whole group re-keys                    | one new entry         |
| **delete a copy** (progress) | entries drop     | **re-keys — the build reds for a fix** | one entry drops       |
| rename a member              | its entries move | whole group moves                      | one entry moves       |

The middle row is disqualifying: paying the debt down reds CI. `disambiguateIdentities` does not
help — it repairs collisions, not churn.

It also inherits the defect keeping [bug 0056](../bugs/0056-a-cycle-identity-changes-when-imports-are-reordered.md)
open, which is **not** the edge-absorption half but the waiver half: `beFreeOfCycles` emits one
violation per SCC, so `.excluding()` can only waive a whole component. One finding per group
means one exclusion pattern waives a clique of 11 and every future duplication among them,
permanently. And with `element` = `"[a, b, c]"`, a string exclusion rots on every membership
change and warns _"it may be stale after a rename"_ — bug 0056's false cause, reproduced in a
new family.

**Per member costs volume and buys everything else.** 1,515 pairs → **855** member findings, not 269. But the concentration this proposal opens with is the **quadratic**, not the missing
grouping: the 153 findings in one file are `C(18,2)` over the 18-member `TechnicalLimitsService`
clique, and per-member turns that file's 153 into 18. So per-member captures the whole
concentration fix and 44% of the volume fix, and the remaining 855 → 269 is bought **entirely**
with the identity instability above. That is a bad trade for a report that can group at render
time for free.

The migration is then one-time and small: today's identity is `duplicate-pair::<a>::<b>`, a
per-member identity is `duplicate-member::<member>`, and every entry moves once.

### 2. Name the extraction target when the group already contains it

The single most actionable finding in the corpus is actionable only because `sendTemplated`
sits at `:620` doing exactly what the other twelve methods inline. That is mechanically
detectable: within a group, the member with the **most parameters and fewest string
literals** is the generalised form. When one exists:

> `sendTemplated` at `resend-email.service.ts:620` already does this — 12 methods need to call it.

That converts a refactoring judgment into a mechanical edit, and it is a remedy that
**can** be verified to remediate, which is what rule 2 asks for.

> **HELD after review — do not ship this until it is counted.** The remedy _shape_ is verifiable;
> the _selection_ is not, and a wrong selection is worse than silence, because the reader was told
> the edit was mechanical. An agent reads _"12 methods need to call it"_, rewrites 12 call sites
> against the wrong target, and the finding does not clear.
>
> Checked against the generated report, on the two examples this proposal leads with: group 4
> (`ResendEmailService`, 13 copies) **does** contain `sendTemplated` — the heuristic's one witness.
> Group 15 (`AssetRepository.create` and 6 more, 7 copies across 7 files) contains **no base
> member at all**, so the heuristic names nothing and the remedy degrades to "extract the shared
> logic" plus a count — the sentence this proposal calls structurally empty. One for two, on its
> own flagship examples.
>
> The heuristic is also corpus-shaped. On a generic TypeScript project "most parameters" selects
> the function that accreted an options bag, not the clean one; "fewest string literals" penalises
> whichever member carries the error messages, which is often the canonical implementation.
>
> Required before it lands: (1) count across all 269 groups, as this section already asks;
> (2) a fixture where refactoring to the named target clears the finding; (3) a fixture where **no**
> member qualifies, asserting the sentence is **absent** — otherwise nothing proves the detector can
> withhold it, and a detector that always names a target has no criterion. If it ships, it ships in
> the report only, never in the gate and never in `suggestion`.

### 3. Report cohesion — and do not call it confidence

Union-find takes the transitive closure of a relation that is not transitive, so a group of
17 may be several refactorings joined at the seams. Density (`actual edges / possible
edges`) discloses that: `clique` = every member matches every other; `chained` = linked
through intermediates.

**Measured, and it must be stated with the feature:** cohesion does **not** predict whether a
group is semantically one operation — **+0.0 accuracy over the base rate on 153 hand-labelled
pairs**, identical to the similarity score itself. It describes how the group was assembled.
Presented as a quality score it would be a false green of exactly the kind this project
files bugs about.

**Note on the two 153s**, which are unrelated and will otherwise be conflated: the 153 findings
concentrated in one file are `C(18,2)` over an 18-member clique, and the 153 hand-labelled pairs
are a separate corpus-wide sample spanning 98 files, of which only 9 touch that clique.

> **Narrowed after review: emit the LABEL, never the number.** A density figure in a finding is
> read as a score whatever the prose beside it says — numbers travel and caveats do not. Emit
> `clique` / `chained` with the one-line explanation, and no percentage. The value is fully
> preserved and the false-green surface disappears. `DUPLICATES.md` already does this correctly,
> with the +0.0 caveat inline beside the label rather than in a footnote.
>
> **One gap to close before this ships:** the +0.0 cohesion figure has **no committed spike**.
> `022-labels.json` carries nine per-pair signals and cohesion is not among them, because it is a
> property of a group rather than a pair; `022-signals-scored.mjs` says it "was scored separately"
> and that scoring is not in the repository. It is the one negative claim here a reader cannot
> re-derive, in a document whose scorer opens by saying the negative claims are unreproducible
> without it.

### 4. Split the gate from the report

The 269 groups are a backlog. A backlog cannot be a build failure without being suppressed.

| surface                                        | audience              | fails build |    findings |
| ---------------------------------------------- | --------------------- | ----------- | ----------: |
| **gate** — "you added a copy of existing code" | the PR author         | yes         |  0–2 per PR |
| **report** — `ts-archunit duplicates`          | a human planning work | never       | 269, ranked |

The gate is diff-aware plus baseline **by default**, and its finding names the original:

```
You added a function that already exists.

  tag.repository.ts:109  TagRepository.create
  duplicates
  asset.repository.ts:441  AssetRepository.create   (22 of 23 lines identical)

  Fix: 6 other repositories contain this same body — it belongs on BaseRepository,
       not in a 7th copy.
```

One finding, an achievable edit, and the "6 others" clause is available only because the
group exists.

> **Re-scoped after review — not a command, and the gate is broken today.**
>
> **The gate does not do what this section names it for.** `--changed` filters on the single
> `violation.file` field (`src/helpers/diff-aware.ts:40`), and a pair finding is located on
> endpoint `a` — `items[i]` with `i < j` in **source-file walk order** (`duplicate-bodies.ts:167`).
> Only `identity` is sorted; `element`, `file` and `line` are not. So you add a copy in
> `z-new.service.ts` duplicating `a-old.service.ts`, the finding lands on the file you did not
> touch, and `--changed` drops it. Measured: with only the second file changed, **0 of 1 kept**.
> Ask ADR-008 rule 5's question — _what does this gate do when someone pastes a copy?_ It passes.
>
> That is a live defect independent of this proposal and it deserves its own bug number. It is
> also this section's strongest argument, and the section does not make it: the split is not a
> nicety, the gate is currently a false green. **Ask 1's per-member shape fixes it** — the new
> copy's own file becomes the finding's file, so the gate fires on the PR that introduces it.
> One-finding-per-group would have made it worse, from a coin flip to 1-in-N.
>
> **"Never fails a build" already exists.** `runCheck` returns the error-severity count only
> (`src/cli/commands/check.ts:158` — _"warns are reported but never fail"_), and both presets
> already register duplication at `'warn'`.
>
> **A `duplicates` command is the wrong shape.** It forks the one execution path, bypassing
> `disambiguateIdentities`, `.excluding()` and its stale-pattern disclosure, comment suppression,
> the `bypassFilters` refusal, and `.rule()` enrichment — which is the cost `terminal-builder.ts:29-35`
> records from bug 0013: _"every safety feature added to one root silently did not reach the
> builders on the other."_ It is also a command per detector in a framework whose position is that
> rules are code and presets are functions; `inconsistentSiblings` would want `ts-archunit siblings`
> tomorrow. And eslint does not ship `eslint no-unused-vars`.
>
> **The generic ask underneath is real and is the one to propose:** the CLI applies baseline and
> diff **run-wide**, and the only escape is `bypassFilters`, which is all-or-nothing and
> force-promotes to `error`. There is no way to say _"this rule is advisory and unfiltered"_ while
> its sibling is gated. **A per-rule filter policy**, honoured by both terminals and the CLI, gives
> this section's whole table as two entries in one rule file on one execution path — and serves
> every detector rather than this one. That is the lego brick; `duplicates` is the narrow feature.
>
> Subtracting what exists, the genuinely new work here is a **ranking function**, a **non-failing
> output surface**, and a **documented recipe**. Note also that "269, ranked" claims a ranking this
> proposal's own evidence section retracts — every signal it measured is dead, leaving group size,
> which nothing here claims correlates with worth-fixing. Say "ordered by size, which is not a
> priority signal", or drop the word.

## What was refuted on the way here

Recorded so it is not re-proposed. All four looked right and died on measurement:

| idea                                                                                 | outcome                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Score `Fingerprint.calls` by exact match to separate copy-paste from framework shape | **Dead.** The 133-line CLI copy-paste scores **58%**, the meaningless Fastify-handler match scores **50%** — the best finding ranks below the worst. Copy-paste-then-rename diverges call names; shared plumbing converges them. The signal runs backwards. |
| Rank findings by body size                                                           | **Dead.** Same-thing pairs are **shorter** (median 17 lines vs 24). Generalised from one 133-line example — the enumerate-from-memory mistake rule 5 warns about.                                                                                           |
| Cohesion as a confidence score                                                       | **Dead.** +0.0 over base rate, n=153.                                                                                                                                                                                                                       |
| Lexical "rename score" over differing call targets                                   | **Insufficient.** Best of nine signals at +4.6pp, but to discard 95% of noise it drops 55% of true findings. Not worth the trade against a 15% noise floor.                                                                                                 |

`Fingerprint.calls` is captured, documented in `docs/smell-detection.md:72` as part of what a
fingerprint records, and **never read by `computeSimilarity`**. That is a docs inaccuracy
worth one line; it is not a latent fix.

## What this design is known to cost

The "What was refuted" table above records what died on **measurement**. Review pointed out that
nothing recorded what a design was known to **cost** — which is why an earlier draft adopted the
membership-keyed identity whose price is an open bug in this repository. Second table, same
discipline:

| decision                             | known cost                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| group in the detector                | none — the pair graph is already computed                                                                  |
| **report per member** (chosen)       | 855 findings rather than 269; one-time identity migration                                                  |
| ~~one finding per group~~ (rejected) | identity churns on every membership change; deleting a copy reds the build; `.excluding()` waives a clique |
| name an extraction target            | a wrong target is worse than none — held until counted                                                     |
| emit cohesion as a number            | read as a score regardless of the caveat — emit the label only                                             |
| a per-detector CLI command           | forks the execution path (bug 0013's cost); one command per detector                                       |

## Sequence

Revised after review. Each step is shippable alone and none blocks on the next.

1. **Defaults and plumbing** — a `describeRule()` override on `DuplicateBodiesBuilder` (its sibling
   has one, six lines, `inconsistent-siblings.ts:104-114`) and a `codeFrame`, which is null only
   because `buildViolations` hand-constructs its violation instead of going through
   `createViolation`. No identity movement, no API change, and it closes four of the five null
   fields the Problem section leads with.
2. **The `--changed` endpoint defect** — file it, fix it. Live today, independent of everything here.
3. **Union-find + per-member findings + the roster in the message.** One migration. This is the
   proposal.
4. **A per-rule filter policy** as a framework primitive, which delivers the gate/report split
   without a command.
5. **Ask 2**, only after counting across all 269, with the withholding fixture.

## Out of scope

- **The matcher.** LCS-over-kind-sequences at ≥0.9 is sound: 45 of 45 hand-read findings were
  genuine structural matches, 0 false. An exact-fingerprint hash (cheaper, O(n), the obvious
  alternative) would **lose** `formatValue`/`formatFieldValue` at 91% — already diverged, a
  live UI inconsistency — and the 133-line CLI group at 95%. Keep the fuzzy threshold.
- **Deciding whether a group is worth collapsing.** Depends on whether the copies will change
  together, who owns them, and whether the abstraction costs more than the repetition. None of
  that is in the source, and a tool claiming it would be lying. 18 limit-check guards are
  genuine duplication and may still be the clearest way to write it.
- **Recall.** Never measured, here or anywhere. 269 groups is what this configuration finds,
  not what exists.
- **`inconsistentSiblings`.** Same base class, not examined.
