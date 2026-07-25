# Bug 0010: Violation identity embeds absolute paths — baselines never match in CI

**Reported:** 2026-07-25
**Found in:** all versions through v0.18.1
**Severity:** High — `withBaseline()`, the documented adoption path, is non-functional for every affected rule. It fails _silently_: the baseline is written, the run is green locally, and CI reports the full finding set as new.

## Description

`hashViolation` identifies a violation by `rule::element::message`
(`src/helpers/baseline.ts:52`). Several producers interpolate **absolute file
paths** into `message` or into the rule description, so the identity hash encodes
the checkout directory.

`generateBaseline` deliberately relativises the stored `file` field —
`"Baseline files store relative paths so they're portable across machines"`
(`src/helpers/baseline.ts:117`) — and the hash defeats that on the next line.

## Reproduction

Measured against `tests/fixtures/smells/duplicate-bodies`:

```
message : parseWebhookOrder (/Users/…/tests/fixtures/smells/duplicate-bodies/file-a.ts:2)
          is 83% similar to parseContentTypeOrder (/Users/…/file-b.ts:2)

hash on the authoring machine : d17408623d5961f9
same finding, CI checkout root: 53c5f2e7059399e9
```

Different hash ⇒ `Baseline.isKnown()` returns false ⇒ **every baselined finding is
reported as new on the first CI run.**

## Affected producers

| Site                                           | How the path enters identity                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/smells/duplicate-bodies.ts:160`           | both file paths written into `message`                                                    |
| `src/presets/boundaries.ts:101-106`            | absolute `dir` → boundary glob → `resideInFolder` description → `violation.rule`          |
| `src/conditions/function.ts:190`               | absolute path in `message`                                                                |
| `src/conditions/body-analysis-module.ts:64,99` | `at line N` in `message` — not a path, but the same class: identity moves when code moves |

So this is **not** smell-specific. Any `strictBoundaries` user has the same broken
baseline today.

## Two further instabilities in the same identity

Fixing paths alone is insufficient:

1. **Derived population counts.** `src/smells/inconsistent-siblings.ts:78` writes
   `"3 of 5 files in <folder> use <pattern>, but X does not"`. Adding one unrelated
   sibling rewrites the message — and therefore the hash — for every already-accepted
   finding in that folder. No coordinates involved.
2. **Pair orientation.** `findSimilarPairs` iterates `i < j` over source-file order,
   so adding a file earlier in the walk can flip a pair from `A→B` to `B→A`, changing
   both `element` and `message`.

The invariant to write down: **a violation's identity must depend only on the
finding, never on where the code sits, how the project is laid out on disk, or what
else exists around it.**

## Why no test caught it

All six `hashViolation` tests build the expected and actual values from the **same
literal** (`tests/core/rule-builder-options.test.ts:26-36,44-63,96-105,124-143`;
`tests/core/rule-builder-exclusions.test.ts:143-151`), and the round-trip
(`tests/integration/baseline.test.ts:40-70`) generates and consumes in one process
from one cwd. Apply ADR-008's question — _what would these do if identity were fully
machine-dependent?_ **Pass, every one.** "Stable identity" is JSDoc prose
(`baseline.ts:12,21,40`) guarded by nothing.

## Suggested fix

- Normalise paths **centrally** in `hashViolation`, against a root anchor. The hook
  already exists and is currently dead: `Baseline` stores
  `private readonly baselineDir` (`baseline.ts:138`) and never reads it.
- Keep coordinates out of identity generally. A duplicate-pair finding needs **two**
  locations and `ArchViolation` carries one, so the partner location needs somewhere
  to live that is not `message` — a generic `relatedLocations` field would serve four
  existing sites that stringify locations into messages today
  (`conditions/cross-layer.ts:78,118`, `conditions/reverse-dependency.ts:174`,
  `conditions/slice.ts:67`).
- Canonicalise the pair (unordered, path-qualified — bare names are not unique).
- Drop derived numerics (the similarity %, the sibling population count) from
  identity; they may stay in the rendered message.

**The guard this needs (ADR-008 rule 5):** hash the same logical code from two
_physically different layouts_ — the fixture, the fixture with blank lines prepended,
and a copy under a different root — and assert set equality of hashes, with a
vacuity guard that every run produced > 0 violations. A same-layout test cannot see
this defect, which is why six of them didn't.

## Migration

Any fix invalidates existing baseline files. For the affected rules there is no
working state to preserve — the baseline never matched in CI — so this cannot
regress anyone, but the CHANGELOG must say **"regenerate your baseline"**, and it is
not only smell users: every `strictBoundaries` user is affected.

## Spike: measured fix (branch `spike/0010-portable-violation-identity`)

Field test — two worktrees of the **same commit** of a large adopting codebase,
checked out at different paths and different depths, 625 files, 1006
`duplicateBodies` findings on each side:

```
v1 (today):  A=1006  B=1006  shared identities =    0
v2 (spike):  A=1006  B=1006  shared identities = 1006
withBaseline(): baseline generated in A, copied to B -> 0 reported as new
stored paths: 0 absolute, 0 traversing ('..'), e.g. apps/api/src/factories/service-factory.ts
```

Zero, not "a few": today **every** finding changes identity when the checkout
moves. Two decisions in the spike were not obvious from the write-up above:

1. **Scrub centrally, don't fix the producers.** `hashViolation(v, root)`
   replaces the root inside `rule`/`element`/`message` before hashing. Repairing
   the four known producers would leave every third-party `defineCondition()`
   with the same broken identity; this covers them. Fixing the producers is
   still worth doing for message _quality_ — it is not the portability fix.
2. **Nearest `.git`, not outermost.** Outermost is tempting for monorepos and
   is wrong the moment any ancestor is also a repository — a home directory
   under dotfiles version control is the ordinary case. The root then sits
   above the checkout and the "relative" path still contains
   `Documents/Projects/…`. It reproduces the bug it fixes. Covered by a test.

Also in the spike: a `hashVersion` field, so a pre-fix baseline produces a
`bypassFilters` meta-finding naming the format gap and the regeneration
command, instead of silently reporting all 1006 accepted findings as new.

### Round 2 — the instabilities that do not involve moving the checkout

Measured against the spike (i.e. with root-scrubbing already applied), each
perturbing the _circumstances_ a message describes while leaving the finding
itself untouched. All three reproduce; all three are now fixed.

| Perturbation                           | `duplicateBodies`  | `inconsistentSiblings` | module body analysis |
| -------------------------------------- | ------------------ | ---------------------- | -------------------- |
| source files enumerated in reverse     | **0 of 1 survive** | 1 of 1                 | —                    |
| one unrelated file added               | 1 of 1             | **0 of 1 survive**     | —                    |
| two lines added at the top of the file | —                  | —                      | **1 of 2, wrongly**  |

The reverse-walk case is not hypothetical: ts-morph resolves tsconfig globs
through directory reads, so enumeration order is a property of the filesystem.
Two machines can legitimately disagree — and the two-worktree measurement above
could never have caught it, because both worktrees read one filesystem in one
order.

The third row is the worst of the three: prepending two lines to a file with
`console.log` at lines 2 and 4 moves them to 4 and 6, and the old entry for line
4 then matches the violation that used to be at line 2. Coordinate-based
identity does not merely lose baseline entries, it **matches the wrong one**.

Dropping the line is not sufficient on its own — within one file those two
findings are distinguished by nothing else, so removing it merges them, and a
merged pair means accepting one accepts both. The scope is narrow: only
`body-analysis-module.ts:64,99` put a coordinate in a message. Every other
`getStartLineNumber()` call feeds the un-hashed `line` field, and
`exclusion-comments.ts:114` is an `ExclusionWarning`, a different type.

Five candidate discriminators, measured over 596 matched nodes in a real
808-file project (merges in brackets):

| scheme               | console.log (284) | JSON.parse (51) | parseInt (58) | process.env (203) |
| -------------------- | ----------------- | --------------- | ------------- | ----------------- |
| today — line         | 284               | 51              | 58            | 202 **(-1)**      |
| enclosing scope only | 42 (-242)         | 43 (-8)         | 52 (-6)       | 40 (-163)         |
| **scope + ordinal**  | **284**           | **51**          | **58**        | **203**           |
| matched node text    | 282 (-2)          | 32 (-19)        | 46 (-12)      | 25 (-178)         |
| scope + node text    | 282 (-2)          | 43 (-8)         | 55 (-3)       | 40 (-163)         |

`scope + ordinal` is 1:1 everywhere, and strictly better than the line, which
already merges two `process.env` accesses that share one. Node text reads like
the meaningful choice and is the worst of the four. Residual cost: adding or
removing a match renumbers later matches **in the same declaration** — 24 of 42
`console.log` scopes hold more than one match, so this is not rare, but it is a
change to that declaration. Today, editing any line above shifts every finding
in the file.

**Fixed in the spike**, via the same `identity` field.

**Fixed in the spike**, via a new optional `ArchViolation.identity` — a
canonical form that replaces `element` and `message` in the hash and leaves the
rendered output alone:

- `duplicate-bodies` — the two endpoints sorted and path-qualified, no
  similarity percentage. Sorting is what makes A→B and B→A one finding.
- `inconsistent-siblings` — file plus pattern, no population count.

Adding the field rather than rewording two messages is the generic move: any
`defineCondition()` whose message names a population, an ordering, or a
coordinate now has somewhere to put a stable identity. It also introduces one
new failure mode — an identity too coarse silently merges distinct findings —
so there is a collision guard, and the real-codebase run reports 1006 findings
to 1006 distinct identities. Known limitation: two anonymous functions in one
file are indistinguishable without a coordinate.

### Round 3 — run as the consumer runs it

The measurements above point the library's own detectors at a real codebase.
That is a corpus test, not a consumer test. So: the spike build was installed
into an isolated checkout of a real adopting project (its own `node_modules`,
its own vitest config) and its architecture suite was run before and after.

**Regression: none.** 12 of 14 files pass, 57 of 57 tests, identical either
side. (The 2 failing files fail on unbuilt workspace subpath exports, an
artefact of installing with `--ignore-scripts`, not on anything in the library.)
That project also does not call `withBaseline()` anywhere, so the format change
cannot regress it — the fix removes a blocker rather than repairing something in
use.

**Adoption, end to end** — the question [proposal 018](../proposals/018-adoptable-discovery-surface.md)
was parked on:

```
cold             check()             -> FAILS, 1006 findings
accept the debt  check({ baseline }) -> PASSES          (1006 entries, hashVersion 2)
plant 1 new dup  check({ baseline }) -> FAILS, 165 NEW  (all naming the planted file)
```

So the answer is yes: a 1000-finding surface **is** adoptable with a working
baseline, and the ratchet is a real ratchet rather than a mute button.

One number is worth carrying forward: copying **one** file produced **165** new
findings. A pairwise detector is quadratic in the duplicated surface, which is
direct evidence against a count-based budget — the count is not a measure of how
much debt was added. That is ADR-008 rule 5's "compare identities, not
integers", observed rather than asserted.

Process note: the first run of this test reported the ratchet as broken. It was
the harness — `project()` memoises by tsconfig path (documented, with
`resetProjectCache()`), so the re-run analysed the pre-plant file set. Diagnosed
rather than reported: the planted file was never in the project (625 → 625
files).

## Notes

Found while reviewing [proposal 018](../proposals/018-adoptable-discovery-surface.md),
which set out to explain why the discovery surface is unused and turned out to have
found a straight bug. 018 retains the strategic question; this is the mechanical
defect underneath it, and it is a precondition for that work.
