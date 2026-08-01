# Proposal 020 — Four Ideas From Packwerk, Evaluated Individually

**Status:** **Closed — nothing to build.** Three parts closed on their own merits (two because
what they asked for already exists), and the fourth is a separate-package question.
**Closed:** 2026-07-31
**Reason:** Part 1's capability is already expressible and documented, and its only evidence —
a misleading remedy string — shipped fixed in v0.25.0. Part 2's stated gap became false in
v0.27.0, and the gate it wanted is a two-line recipe, now in `docs/setup-best-practices.md`.
Part 3 is already answered by the README's own positioning. Part 4 would be its own package.
Kept as a record of why, and of two traps a future author would otherwise rediscover: the
remedy conflict between a privacy preset and `no-cross-boundary`, and the absolute-path-to-
`picomatch` vacuity in the sketch that draft 1 proposed.

**Draft 2 — three of four parts closed.** Draft 1's dispositions were right and its
evidence has since expired: two of the four parts rested on present-tense claims about the
codebase that stopped being true within 24 hours of writing. Corrected below, with what
actually shipped.
**Verified against:** v0.30.0 (2026-07-31). Re-verify the preset, baseline and docs surfaces
before drafting anything here — draft 1 rotted in two days because it had no review trigger.
**Review trigger:** an adopter asking for entry-point privacy or a baseline-growth gate by name.
Absent that, the README comparison table is already the demand instrument: it advertises each
gap publicly and names the workaround, and nobody has filed against it.
**Priority:** Mixed — see per-part disposition
**Affects:** varies per part (see below)
**Origin:** A 2026-07-28 comparison of Shopify's Packwerk (Ruby/Rails package-boundary
tool) against ts-archunit/eess, requested by the maintainer. **This is a different kind
of origin than proposals 013–019**, all of which trace to a bug corpus or a real
adopter session. "Another tool does X" is weaker evidence than "an adopter hit X" —
see closed proposals 002/003, both rejected because the problem didn't hold up once
someone looked. That standard is applied here, per part, rather than assuming all four
ideas clear it because one of them does.

## How to read this document

Four ideas came out of the comparison. Draft 1 held all four as "logged, pending an adopter";
draft 2 closes three of them, because their answers turned out to already exist.

Part 1 started out promoted, on the reasoning that it wasn't just "Packwerk has this" — it's a
specific, verified mismatch between what `strictBoundaries()`'s own code claims to enforce and
what it actually enforces. Draft 1 then demoted it, correctly: the mismatch proves the
`because`/`suggestion`/`imperative` **text** is wrong, not that anyone needs the stronger
feature (entry-point-only privacy) that text describes. Draft 1 split those and filed the text
half as [bug 0017](../../bugs/fixed/0017-boundaries-no-cross-boundary-message-overclaims-entry-point-enforcement.md).

**That bug shipped fixed in v0.25.0, the day after draft 1 was written**, and draft 1 asserted
four times that it was "filed and actionable on its own". With the proven half closed, what
remained was a feature request with **no evidence at all** — and, it turns out, a feature that
is already expressible. Part 1 is closed on both counts.

The lesson generalises past this document: a "logged, revisit later" proposal is a claim about
a codebase, and it decays. Draft 1 had no `Verified against:` line and no review trigger, which
is why it rotted in two days while proposal 021 — which has both — did not.

| Part | Idea                      | Evidence                                              | Disposition                                                                                   |
| ---- | ------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1    | `packagePrivacy()` preset | **None left.** Its one proven part shipped in v0.25.0 | **Closed.** Already expressible and documented — `docs/what-to-check.md:681-687`              |
| 2    | Baseline-growth ratchet   | Inference from Packwerk; no adopter report            | **Closed.** The delta shipped in v0.27.0; the gate is a two-line recipe, now in the docs      |
| 3    | Dependency graph export   | The README's own comparison table                     | **Closed.** The README already answers it: use dependency-cruiser alongside (`README.md:372`) |
| 4    | IDE live feedback         | Packwerk ships editor plugins                         | Out of scope — separate-package question. Unchanged; needs no revisiting                      |

**Why three parts closed rather than staying logged.** Draft 1 held everything "pending an
adopter". That bar is right for a _feature_ and wrong for a part whose answer already exists — a
logged part reads as an open question, and three of these are not open. Part 4 keeps the original
disposition because it is the one where "pending an adopter" is genuinely the state.

---

## Part 1 — Package-Level Privacy Preset (`packagePrivacy`) — CLOSED

**Disposition:** **Closed, 2026-07-31.** Both halves resolved, neither by building anything.

### The text half shipped

Draft 1's only evidence was that `no-cross-boundary`'s remedy described entry-point enforcement
while the condition implemented folder-level isolation. Filed as
[bug 0017](../../bugs/fixed/0017-boundaries-no-cross-boundary-message-overclaims-entry-point-enforcement.md),
**fixed in v0.25.0**. `src/presets/boundaries.ts:240-241` now reads:

> boundaries may only depend on themselves and the shared modules — an import from another
> boundary couples the two, whichever file it names

and the comment above it (lines 230-239) records the measurement that forced the change: applied
literally, the old `Fix:` line reproduced the identical violation, so an agent obeying it looped.

### The feature half is already expressible, and already documented

Draft 1 sketched a preset generating one `onlyBeImportedVia` rule per non-public file. That
sketch has been **deleted rather than kept "for reference"**, because its stated purpose was to
save a future author from re-deriving the design, and what it actually preserved was an expensive
and wrong derivation. Three things were wrong with it:

1. **The capability already ships, in one rule.** `docs/what-to-check.md:681-687` teaches it:

   ```ts
   modules(p)
     .that()
     .resideInFile('**/internal/**/*.ts')
     .should()
     .onlyBeImportedVia('**/index.ts', '**/internal/**')
     .check()
   ```

   For "every file in the package except the barrel", `not()` composes with the identity
   predicates through `satisfy()` — `.satisfy(not(resideInFile(`${dir}/\*\*/index.ts`)))` — which is
   one rule per boundary, not one per file. The sketch did at rule-construction time what the
   predicate layer already does at evaluation time.

2. **It scaled the wrong quantity.** `strictBoundaries` generates O(boundaries) rules; the sketch
   generated O(private files) — roughly 120 extra rules on a 147-file consumer, all sharing one
   id. Draft 1 called this "same complexity class … not a new performance concern", which is
   wrong: [proposal 021](../021-consumer-run-time-where-it-actually-goes.md) measures rule
   execution overtaking project load somewhere around 140 rules. `explain --markdown` and
   `--format json` do not dedupe, so all ~120 would print; `explain --format agent` dedupes on
   `imperative`, so it survived only because the sketch's imperative happened to be constant.

3. **It had a silent vacuity bug.** The sketch passed an **absolute file path** to
   `resideInFile`, which is `picomatch(glob)` (`src/predicates/identity.ts:76`). Any checkout
   path containing a glob metacharacter — `/Users/x/Projects (old)/repo` — selects nothing, and
   the rule passes. A per-file invisible vacuous pass, inside a preset the user cannot see into:
   exactly the ADR-008 shape `assertDiscovered` exists to prevent, reintroduced one level down.

### If it is ever reopened

The remaining question is narrow and is **not** "build a preset": it is whether the one-rule
form above deserves to be a named preset at all, given a team can write it in five lines. Two
things a future author needs that draft 1 did not record:

- **`onlyBeImportedVia` is at `src/conditions/reverse-dependency.ts:105`** (draft 1 said 152-184),
  and `discoverBoundaryFolders()` does not exist — the discovery loop is inline in
  `src/presets/boundaries.ts:118-127`. A second consumer of it would be the point at which
  factoring it into `shared.ts` pays.
- **The two presets contradict each other's remedies if both are enabled**, which draft 1
  invited ("a team can adopt `strictBoundaries` alone, `packagePrivacy` alone, or both"). A
  privacy remedy says "import from the package's `index.ts` instead"; `no-cross-boundary` forbids
  importing anything outside `A/**` + shared, **including** `B/index.ts`. An agent obeying the
  first produces a violation of the second — bug 0017's remedy loop recreated across two presets.
  Settle that before writing any code, and note draft 1's three-case acceptance test did not
  cover it.

---

## Part 2 — Baseline-Growth Ratchet — CLOSED

**Disposition:** **Closed, 2026-07-31.** Draft 1's stated gap became false before it was read,
and what remained is a docs recipe, now written.

### What draft 1 claimed, and what shipped

Draft 1 said: _"Nothing today diffs the baseline file's own contents against a prior version."_
**v0.27.0 shipped exactly that.** `generateBaseline` reads the prior file before overwriting
(`src/helpers/baseline.ts:319`) and returns a `BaselineDelta` (line 407) with `before`, `after`,
`added`, `removed` and `priorHashVersion`; the CLI prints it
(`src/cli/commands/baseline.ts:62`), and `docs/cli.md` documents it.

So the diff, the data and the reporting all exist. The only missing piece was the **gate** — a
check that _fails_ on growth — and that is two lines of already-public API. It is now in
`docs/setup-best-practices.md` under "Enforcing the ratchet", together with the one-line
`git diff --exit-code arch-baseline.json` version, which is stricter and is the right default.

This is proposal 003's reasoning applied literally rather than by analogy: a one-line workaround
already exists and nobody has asked for the stronger primitive.

### Two things the docs recipe had to get right, recorded for whoever revisits

1. **`added` alone is not a sufficient gate.** It counts _identities_, and two findings can share
   one, so a PR adding a duplicate of an already-accepted violation has `added === 0`. The recipe
   compares the count as well. (Dependency findings stopped colliding in v0.29.0 —
   [bug 0028](../../bugs/fixed/0028-two-findings-in-one-file-can-share-a-baseline-identity.md) — but
   the general case remains, so the gate does not assume otherwise.)
2. **`generateBaseline` writes before it returns the delta**, so the programmatic gate accepts
   the growth and then complains about it. Harmless in CI, wrong locally. If this ever does earn
   a flag, the real increment is a **non-destructive** comparison, and the primitive for it
   already exists as a private function — `readPriorHashes` (`src/helpers/baseline.ts:359`). One
   export plus a flag is the honest remaining scope, and it is much smaller than draft 1 implied.

Draft 1 also proposed `--check-no-growth <prior-baseline>`, taking an explicit prior path. Note
that the shipped delta compares against the file at `--output`; two mental models, and whichever
ships should match the one users already learned.

---

## Part 3 — Dependency Graph Export — CLOSED

**Disposition:** **Closed, 2026-07-31.** The product already answers this, confidently, in the
document draft 1 cited as its origin.

Draft 1 noted that the README's comparison table lists "Dependency graph visualization: No"
against dependency-cruiser. It read that as an acknowledged gap. It is better read as a
**position**, and the README states it two lines further on (`README.md:372`):

> **Use ts-archunit + dependency-cruiser together** if you want both body-level enforcement and
> dependency graph visualization.

Holding the part open as a maybe undercuts a stance the product already takes. Closed with that
reasoning recorded, rather than left as an open question nobody is going to answer.

One correction for anyone who reopens it: `getReverseImportGraph` is at
`src/conditions/reverse-dependency.ts:42` (draft 1 said 117-136) and **is not exported**, so it
cannot be the basis of a `graph` command. The right seam is `moduleEdges()`
(`src/core/module-edges.ts:133`), which is exported and whose return type is deliberately
ts-morph-free. That makes the feature "serialization over an already-correct public seam" — a
stronger argument than the one draft 1 made, and worth having on record.

---

## Part 4 — IDE Live Feedback

**Recommended disposition:** Out of scope for this repo's core proposals flow.
**Affects:** N/A — would be a wholly separate package (e.g. `@ts-archunit/vscode`), not
a `src/` change.
**Origin:** Packwerk ships `packwerk-vscode`/`packwerk-intellij` as separate ecosystem
packages; ts-archunit's feedback loop is CLI/CI/GitHub-annotations only today.

### Why this doesn't belong here

Proposal 015 already litigated this category of question for Bun support: a
runtime/tooling integration is a separate package with its own release cadence, gated
on real, independently-observed demand — not a core-primitive change. An IDE extension
is the same shape of decision, one level further from core (it wouldn't touch `src/` at
all). If pursued, it should start as its own proposal with a team explicitly asking for
live in-editor feedback behind it, not as a bullet in a tool comparison.
