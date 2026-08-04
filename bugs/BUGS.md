# ts-archunit Defects

**Version:** 0.54.0 · **Open:** 4 · **Fixed:** 60 (`fixed/`) · **Updated:** 2026-08-04
**Roadmap:** `../plans/ROADMAP.md` · **Standard:** [ADR-008](../adr/008-agent-first-failure-surfaces.md)

> Conventions: a bug lives here while open and moves to `fixed/` when it ships, with a
> **Fix as shipped** section and its sabotage matrix. The location is the status — a
> header claiming FIXED in `bugs/` is a bug about a bug. Severity is about **blast
> radius**, not frequency: a rare fault on a published API outranks a common one behind
> an internal seam, per [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6.

---

## Open

All four came out of the five-persona review of v0.47.0–v0.49.0 (except 0054, which those releases found).
Every claim below was reproduced by measurement before filing.

| Bug                                                                                                                                            | Severity    | What                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [0056](./0056-a-cycle-identity-changes-when-imports-are-reordered.md) — a cycle's identity changes when imports are reordered                  | **High**    | Same root. Reordering two imports changes `element` from `[a, c, b]` to `[a, b, c]`, reds CI, and the diagnostic blames a rename that never happened. Fail-**open** in the other direction: an SCC absorbs new intra-component edges without changing its name, so a new cycle among 4 of our 6 gated slices is silently accepted.                           |
| [0059](./0059-slice-conditions-and-module-conditions-disagree-about-a-dependency.md) — slice and module conditions disagree about a dependency | Medium-high | `notDependOn` reports 0 and `notImportFrom` reports 1 on the same dynamic import, in the same run. The shared edge-kind set is justified by a _cycle_ argument and applied to two conditions that are not about cycles. Bug 0022's shape one layer up.                                                                                                       |
| [0061](./0061-an-all-caps-stub-marker-no-longer-matches.md) — an all-caps stub marker no longer matches                                        | Medium      | `// NOT IMPLEMENTED` and `// COMING SOON` miss, against a docstring that claimed the phrase forms stayed case-insensitive. False-negative direction, so nothing tells the user.                                                                                                                                                                              |
| [0062](./0062-the-release-pipelines-gates-drift-and-its-diagnostics-misname-the-cause.md) — the release pipeline's gates drift                 | Medium      | `shellcheck` is in `ci.yml` and not `publish.yml`; a 429 reds the docs step naming four wrong causes; that step's timeout is budgeted at 600s against a 720s worst case; the docs site deploys independently of publish success with no concurrency group. **Verified sound:** a tag cannot publish a failing commit, and no fixture leaks into the tarball. |

One closed in v0.54.0:
[0060](./fixed/0060-a-pattern-change-silently-invalidates-every-baselined-finding.md) — a shipped default
pattern's text is part of a baseline identity, so changing it was a silent migration, and the diagnostic
blamed the repository root.

One closed in v0.53.0:
[0063](./fixed/0063-a-dependency-identity-collides-across-files-sharing-a-basename.md) — a dependency
identity collided across files sharing a basename, in **three** mechanisms rather than the one filed.

Two closed in v0.52.0:
[0054](./fixed/0054-within-makes-helpers-depend-on-builders.md) (`within()` moved to `builders/`; **both**
waivers deleted, so all 46 architecture rules pass with no exclusions) and
[0055](./fixed/0055-a-cycle-finding-names-edges-that-do-not-exist.md) (the cycle message no longer asserts
arrows it cannot substantiate, and the finding is located on an edge that exists).

Two closed in v0.50.0: [0057](./fixed/0057-an-empty-options-object-reverts-a-documented-default.md)
(an empty options object reverted a documented default) and
[0058](./fixed/0058-workspace-applies-one-packages-compiler-flag-to-all.md) (`workspace()` applied one
package's compiler flag to every package, wrong in both directions).

Three bugs closed 2026-08-04 and shipped in v0.47.0:
[0051](./fixed/0051-the-jsx-entry-point-has-never-run-against-a-file-on-disk.md),
[0052](./fixed/0052-nostubcomments-cannot-see-a-functions-own-docstring.md) and
[0053](./fixed/0053-the-stub-rule-matched-prose-about-stubs.md) — the last of which caused 0060 and 0061,
which is the pattern `BUGS.md` already records: **fixing a false green often widens a neighbouring one.**

Known gaps that are **not** defects live in plans, with their reasoning recorded:

| Plan                                                                                                            | Why it is not a bug                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0081](../plans/completed/0081-a-condition-declares-discovery-ownership.md)                                     | Discovery-diagnosis ownership is per **builder** and is really per **condition**. Nothing broken since v0.45.1; hardening a seam whose failure mode already fired once.                            |
| [0082](../plans/completed/0082-an-object-literal-callback-keeps-its-name.md)                                    | A callback on an object literal loses its name, so a rule about `handler` is writable and selects nothing. Capability gap, not a false green — and the only one with a published-API blast radius. |
| [0072](../plans/0072-a-denylist-glob-that-cannot-match.md)                                                      | **Refuted 2026-07-30** — both mechanisms died on measurement. Kept so it is not re-proposed.                                                                                                       |
| [0047](../plans/0047-typescript-escape-hatch-matchers.md), [0048](../plans/0048-using-tagged-symbol-matcher.md) | Matcher proposals — new capability, not repair.                                                                                                                                                    |

------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0049](./fixed/0049-the-type-assertion-self-check-selected-classes.md) — four `as` casts in shipped source | **OPEN, low as a defect / medium as a signal.** Every cast is currently true, so nothing is broken — but we ship `noTypeAssertions()` as a guardrail and break it four times. The real deliverable is **why our own self-check did not fire**; the casts are the symptom. Found while verifying a review finding about a fifth cast, since fixed. |

This file previously said `Open: 0` in its header while its tables listed 0044 and 0048 as
**OPEN** — both already shipped and already moved to `fixed/`. Under this file's own convention
the location is the status, so the tables were the error. They were written when the two were open
and never revised, which is the same staleness the defects below are about, in the index that
exists to track them. The queue is now derived from the directory rather than restated.

Known gaps that are **not** defects live in plans, with their reasoning recorded:

| Plan                                                                                                            | Why it is not a bug                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0081](../plans/completed/0081-a-condition-declares-discovery-ownership.md)                                     | Filed from the v0.44/v0.45 architecture review. Ownership of the discovery diagnosis is declared per **builder** and is really per **condition** — the coarse grain concealed bug 0040's final-layer half. Nothing is broken since v0.45.1; this hardens the seam.     |
| [0082](../plans/completed/0082-an-object-literal-callback-keeps-its-name.md)                                    | Capability gap, not a false green: two callbacks on one object literal are indistinguishable through `ExtractedCallback`, so a rule about a `handler` callback cannot be written. Found by plan 0079 needing the identity and having to derive it outside the library. |
| [0079](../plans/completed/0079-triage-the-cardinality-only-assertions.md)                                       | A sampling exercise with a stop rule, not a fault. Nothing is known to be broken; the work is finding out whether anything is.                                                                                                                                         |
| [0072](../plans/0072-a-denylist-glob-that-cannot-match.md)                                                      | **Refuted 2026-07-30** — both proposed mechanisms died on measurement, and the question was already settled correctly elsewhere. Kept so it is not re-proposed.                                                                                                        |
| [0047](../plans/0047-typescript-escape-hatch-matchers.md), [0048](../plans/0048-using-tagged-symbol-matcher.md) | Matcher proposals — new capability, not repair.                                                                                                                                                                                                                        |

Residues from shipped fixes are written into the bug that owns them rather than kept as tickets:
the derivation bound in [plan 0078](../plans/completed/0078-derive-the-configuration-finding-census.md),
anchors in [0046](./fixed/0046-cross-document-links-rot-silently.md), and the comment-feedback
direction in [0044](./fixed/0044-an-inline-exclusion-comment-has-no-feedback-channel.md).

---

## Patterns worth remembering

Not a list of bugs — a list of the shapes they keep taking. Each is drawn from more than
one entry in `fixed/`.

- **A guard whose list is hand-written cannot fail when the list goes stale.** Bugs 0036
  and 0042 are the same defect at different surfaces; [plan 0078](../plans/completed/0078-derive-the-configuration-finding-census.md)
  is the third instance. Derive the census from source.
- **A test that asserts the call is not a test of the consequence.** Bugs 0038 and 0041
  both hid behind a spy or a helper that supplied the very thing under test.
- **A remedy is a claim, so it needs a behavioural test.** Bug 0017 taught it; bug 0042
  shipped **two** more wrong remedies while fixing it, neither catchable by asserting
  message content. Apply the fix and assert the finding clears.
- **The verdict mechanism is part of the derivation.** Bug 0045 is this at the process
  layer; an unquoted `$SUITE` in zsh and a symlinked `node_modules` have each produced a
  full matrix of false CAUGHTs.
- **A guard's SELECTOR decides what it can ever see, and nobody sabotages a selector.** Bug 0049's
  type-assertion self-check was correct, well-tested, and selected `classes` in a codebase with 19
  class files and 128 function files — so it guarded the shape we barely use, and never fired on any
  of the 22 casts we shipped. Widening the glob would not have helped; the scope was wrong in a
  different dimension. Ask what element **kind** a rule selects, not only what paths.
- **A count of 1 is never sufficient where a configuration finding can appear.** A dead selector
  emits exactly one finding, so `toHaveLength(1)` accepts it when the condition never ran —
  measured on two blocks in `widened-module-edges.test.ts`, one of which carried the comment
  "The false green this release must not create". The affirmative form of this was already
  written twice (`slice-rule-builder`, `rule-builder` assert `bypassFilters === true` on
  purpose); nobody had written the negative. Assert the identity, or assert
  `bypassFilters === false`.
- **A sabotage matrix cannot enumerate an omission.** Bug 0040 named its own missing case in
  prose; the plan that fixed it reported 7 of 7 caught, all seven genuinely firing, and the
  named case was not among them because **code never written has no line to revert**. It
  shipped and ran wrong for two releases on the most-used cross-layer condition. When a bug
  names a case in prose, that sentence becomes a matrix row — see
  [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 5.
- **A guard's SCOPE is part of the guard, and it is the half nobody sabotages.** The
  cross-document link check ([0046](./fixed/0046-cross-document-links-rot-silently.md)) was
  correct on every document it walked, and did not walk the four at the repository root —
  where seven dead links sat in `CHANGELOG.md`, the most-read document and the heaviest
  linker into the two directories whose files get renamed. Sabotage asks "would this catch
  the fault?" and gets a truthful yes. Also ask **"where does it not look?"**
- **A count written in prose is a hand-maintained list of one.** v0.45.2 retired four:
  `violation.ts` said "three of the four suppression paths" against a roster of six, and
  "five of the six producers" against a census of fifteen; `diagnose.ts` named as examples
  the two builders whose fix it was describing, contradicting a passing test. Name where the
  value is derived instead — the same reasoning as the census itself. Measurements are the
  exception: "measured on the 0.23.0 branch" is a record, and records do not decay.
- **Fixing a false green often widens a neighbouring one.** v0.37.0 fixed bug 0041 and
  thereby widened 0039, 0043 and 0044. Check what a fix makes _reachable_.
