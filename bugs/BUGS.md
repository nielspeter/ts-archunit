# ts-archunit Defects

**Version:** 0.58.0 · **Open:** 5 · **Fixed:** 67 (`fixed/`) · **Updated:** 2026-08-07
**Roadmap:** `../plans/ROADMAP.md` · **Standard:** [ADR-008](../adr/008-agent-first-failure-surfaces.md)

> Conventions: a bug lives here while open and moves to `fixed/` when it ships, with a
> **Fix as shipped** section and its sabotage matrix. The location is the status — a
> header claiming FIXED in `bugs/` is a bug about a bug. Severity is about **blast
> radius**, not frequency: a rare fault on a published API outranks a common one behind
> an internal seam, per [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6.

---

## Open

0056 and 0062 came out of the five-persona review of v0.47.0–v0.49.0. **0066 and 0068 came from a
different method, and it is worth naming: running the published package against an external corpus**
(cmless `main` @ `1481446`, 2,371 TS/TSX files) rather than reading our own source. Neither was visible
from inside — 0066 because every fixture here has files in it, 0068 because our fixture uses the one
object-literal shape the existing prefix handles. Both are in families our own suite exercises heavily.
0068 shipped fixed in v0.58.0; 0066 is carried by [plan 0098](../plans/completed/0098-the-evidence-seam-and-the-floor.md),
which fixes it as part of one release rather than as a fifth per-family wave.

0069 came from a third method worth naming too: **a measurement taken to test an unrelated hypothesis.**
Probing whether `within()` fails open (plan 0095's Phase 0 — it does not) printed a finding whose first
sentence named a method the rule never called. Nothing was looking for it. The suspicion under test was
refuted and the byproduct was the real defect, which is an argument for running the probe even when you
expect it to come back clean. Fixed in v0.58.0, same day.

This paragraph used to end _"Every claim below was reproduced by measurement before filing"_, and that
sentence is withdrawn. It was not true of 0064, which shipped with a **"Not measured"** section and a
remedy reasoned from a table — the remedy was then refuted by two independent measurements. A blanket
verification claim over a table that contains an explicit non-verification is precisely the false-green
shape [ADR-008](../adr/008-agent-first-failure-surfaces.md) is written against, and it is worse than no
claim because it discourages the checking that caught it. **Each bug states its own evidence, per claim,
and marks what is expected rather than measured.**

| Bug                                                                                                                                                                          | Severity | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0071](./0071-nothing-guards-the-published-method-surface.md) — nothing guards the published method surface                                                                  | Medium   | A public method can be added to or removed from any published builder and **every gate stays green** — measured by restoring `allowEmpty()` as a live method on the 0097 branch: typecheck, 3198 tests, `verify-package.mjs` and the vacuity matrix all exit 0. Removing it only redded because three of our own test files happened to call it, which is usage coverage, not a guard. Each instrument misses for its own reason; the matrix's is that `enumerate.ts` recurses only into namespace objects and **a class constructor is a function**, so it is a behavioural truth table over constructors and never an API-surface census. Filed because [plan 0098](../plans/completed/0098-the-evidence-seam-and-the-floor.md) retypes `collectViolations()` — a method-level change to ADR-010's contract — and names that matrix as its independent check. Plausibly one piece of work with ADR-010 rule 4's contract fixture.                                                                                                                                                                                                                           |
| [0072](./0072-a-tsconfig-enum-option-reports-required-x-actual-x.md) — a tsconfig enum option reports "required ES2022, actual ES2022"                                       | Medium   | `requires({ target: 'ES2022' })` fails on a project that already sets `"target": "ES2022"`, with a `Fix:` telling you to set what is already set — ADR-008 rule 2, a remedy that cannot remediate. ts-morph returns the **numeric enum** (`target` is `9`, `module` is `7`), `valuesEqual` compares raw so `'ES2022' !== 9`, and `displayValue` then renders **both** sides through the enum name table. Neither half is wrong alone. No test catches it because every case in `tests/config/tsconfig.test.ts` passes `ScriptTarget.ES2022` — the string spelling a user copies from their own tsconfig is never exercised. Found incidentally while measuring 0098's examined unit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [0070](./0070-an-object-literal-in-a-call-argument-has-no-scope-so-siblings-share-an-identity.md) — a literal in a call argument has no scope, so siblings share an identity | Low      | Two `register({ handler: … })` calls in one file produce **one identity** for both arrows — measured identical on 0.57.0 and 0.58.0, so 0068's fix narrows around it rather than causing it. Same fail-open class as 0068 (a ceiling keyed to a positional slot), but it needs two same-key literals in call arguments in one file, both breaching the same metric, and no occurrence has been measured in a real corpus. Nothing stable distinguishes them — position is what breaks ratcheting — so the likely outcome is a documented limit **plus a warning that the identity was disambiguated positionally**, which is the information a baseline consumer is missing today. Filed because it was living in a docblock.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [0056](./0056-a-cycle-identity-changes-when-imports-are-reordered.md) — a cycle's identity changes when imports are reordered                                                | **High** | Same root. Reordering two imports changes `element` from `[a, c, b]` to `[a, b, c]`, reds CI, and the diagnostic blames a rename that never happened. Fail-**open** in the other direction: an SCC absorbs new intra-component edges without changing its name, so a new cycle among 4 of our 6 gated slices is silently accepted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [0062](./0062-the-release-pipelines-gates-drift-and-its-diagnostics-misname-the-cause.md) — the release pipeline's gates drift                                               | Medium   | ~~`shellcheck` is in `ci.yml` and not `publish.yml`~~ — **that half is now fixed**, `shellcheck` runs in `publish.yml`, though as a hand-maintained second copy rather than the reusable workflow the bug prescribed, so the drift is reset and not prevented. ~~the docs site deploys with no concurrency group~~ — **also fixed**, `docs.yml` has one now; a version gate was built alongside it and **reverted the same day** (it stranded docs between a release merge and its tag, treated an unreachable registry as "not published" while reporting green, and its release-path half would have been rejected by the `github-pages` environment, which allows the `main` branch and no tags). Still open: that step's timeout is budgeted at 600s against a ~660s worst case. **Gap 2's premise is refuted** — twelve publish runs sampled, **zero 429s**; what actually recurs is a false "index unchanged" warning on every release, because the Context7 crawl finalises ~29 minutes later, past any poll budget. Re-specify before implementing. **Verified sound:** a tag cannot publish a failing commit, and no fixture leaks into the tarball. |

| [0066](./0066-a-smell-detector-over-zero-files-passes.md) — a smell detector over zero source files passes | **High** | `smells.duplicateBodies(p).check()` over a project that loaded **zero files** passes — measured, and on the corpus it reported **401 findings as clean** across two apps (23% of its TypeScript). The empty-project check sits _inside_ the dead-glob gate, behind an early return that fires whenever the rule declares no glob, and smell detectors declare none. `inconsistentSiblings` fails open identically (measured). **The preset claim was corrected after review**: 6 of 7 `agentGuardrails` rules throw loudly, so the silent path is a smell-only rule file or the direct API — which is what the corpus evaluation used. `doctor` catches it today and `check` does not, and `docs/cli.md` tells adopters not to put `doctor` in CI. |

**Three closed in v0.57.0, by one fix.**
[0064](./fixed/0064-a-dependency-identity-collides-across-two-spellings-of-one-module.md) (two spellings
of one module), [0065](./fixed/0065-reverse-dependency-findings-carry-no-identity.md) (the reverse family
set no `identity` at all) and
[0067](./fixed/0067-a-duplicate-pair-identity-collides-on-two-same-named-functions-in-one-file.md) (two
same-named functions in one file) were four separate reports of one invariant that
`ArchViolation.identity` had always stated in prose and nothing enforced — 0028 and 0063 being the earlier
two. Each had been fixed only in whichever family got reviewed. **v0.57.0 fixed the mechanism instead**:
`disambiguateIdentities` runs in the one path every terminal shares, so `src/conditions/`, `src/smells/`
and any producer written in future are covered together. 0067 needed no change to its detector at all.

Two things that record kept, which a closed bug usually loses: 0064's first proposed remedy is preserved
**as refuted** (it moved 129 of 975 identities to close 3), and 0067's proposed structural rewrite is
**explicitly withdrawn** — it would now cost a migration to fix a defect that no longer loses coverage.
The shipped tiebreaker is positional, so the equal-count swap remains open and is tracked in
[plan 0094](../plans/0094-the-residual-findings-from-the-v0-56-0-review.md), not here.

One closed in v0.55.0:
[0061](./fixed/0061-an-all-caps-stub-marker-no-longer-matches.md) — `// NOT IMPLEMENTED` and
`// COMING SOON` stopped matching. Its classification of every reported row also widened
[plan 0091](../plans/0091-a-stub-marker-is-delimited-not-cased.md) with three findings that are the
**anchor's** doing rather than the casing's, including a bulleted `- TODO:` in a JSDoc list.

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
