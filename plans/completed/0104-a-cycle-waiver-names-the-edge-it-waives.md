# Plan 0104 — A Cycle Waiver Names The Edge It Waives

**Status:** Implemented on `main`, unreleased. Phases 1–2 (mechanism + test migration) and Phase 3's
`docs/slices.md` example are done; the `docs/upgrading.md` row and `CHANGELOG.md` entry are drafted
below (Release) and land at actual release time, not before — consistent with this project's convention
that a version-keyed doc row names a version that has shipped. Revised once, by a five-persona review
(2026-08-12) that found two Critical gaps — the
KNOWN LIMIT/minimal-diff tests asserted `identity` or "still present" without asserting `element`/"absent,"
which a completely broken `.excluding()` or a sabotaged `element` would both pass; and an incorrectly-cited
`HASH_VERSION` precedent (the plan argued against a bump using the exact premise `baseline.ts`'s own history
uses to justify bumping) — plus a real, previously-unmitigated loophole (a loose `.excluding()` regex
silently reopens the exact bug this plan fixes) that now gets a mechanical check instead of documentation
alone. All three, plus a stale release-count figure, an under-enumerated file list, and several
migration-communication gaps, are fixed inline below rather than left for the implementer to rediscover.
**Splits out of:** [plan 0088](./0088-a-slice-finding-identifies-itself.md) Phase 4, once Phases 1–3
shipped in v0.52.0 without it — same shape as
[plan 0093](./0093-a-reference-consumer-for-the-presets.md) splitting out of plan 0083 Phase 3 when
that phase's hard requirements shipped without its wrapper. Phase 4's own text left this decision open
("Decide deliberately whether this is in scope here or its own plan"); this plan decides it, in its own
document, for the reasons under **Why standalone**, below.
**Fixes:** [bug 0056](../bugs/0056-a-cycle-identity-changes-when-imports-are-reordered.md)'s fail-open
half — the bug stays open, by its own text, until this lands. Corrects the disproven "fail-closed" claim
[bug 0054](../bugs/fixed/0054-within-makes-helpers-depend-on-builders.md) made and bug 0056 already retracted.
**Reconciled against bug 0056's own Test inventory (review: product, asked whether this plan fully closes
it)**: rows 1/3/5 already closed by the fail-red half (v0.52.0); row 2 ("a new cycle... is REPORTED") is what
this plan closes; row 4 ("the `.excluding()` example in `arch-rules.test.ts` still matches, fail-closed
comment corrected") is moot — checked directly against `tests/archunit/arch-rules.test.ts:698-723`, which
carries zero `.excluding()` calls and no "fail-closed" comment today, both already removed when bug 0054's
fix deleted the waiver they described.
**Priority:** High — tracks the _severity_ of the lie, not today's measured exposure, the same distinction
[plan 0102](./0102-a-detector-that-cannot-fire-says-so.md)'s header draws between priority and blast
radius. Bug 0056 calls this "the more important row" and "worse" than the fail-red half already fixed: a
waiver silently absorbs any _new_ architectural cycle confined to an already-waived component, which is a
silent false green in exactly the shape this project exists to prevent. **Measured exposure today is zero**
— bug 0054's fix deleted our own four-slice waiver in the same release that introduced the sorted-member fix,
so nothing in this repository is currently absorbed (confirmed: `arch/no-cycles` in
`tests/archunit/arch-rules.test.ts` runs `.check()` with zero `.excluding()` calls). No measured count of
external adopters who both call `beFreeOfCycles()` and `.excluding()` a cycle finding exists — unlike plan
0102's "used ~zero times" figure (traceable to `ROADMAP.md:162`), no equivalent measurement exists for this
family. Say that plainly rather than invent a number: the case for High rests on the mechanism's severity
and on this project's own history with it (bug 0054's waiver silently absorbed for the time it existed), not
on measured current-adopter blast radius.
**Effort:** Medium. The mechanism change is small and localized — one loop in `beFreeOfCycles`, from taking
`edges[0]` to iterating every internal edge. The surface is not: a measured **27-call-site floor** across
**5** test files assert the whole-SCC element shape (`grep -rn "toEqual(\['\[a" tests/ | wc -l`, re-verified:
`cycle-message-and-identity.test.ts` 3, `type-only-cycles.test.ts` 9, `re-export-edges.test.ts` 5,
`verbatim-module-syntax.test.ts` 5, `workspace-per-package-options.test.ts` 5), 24 files reference
`beFreeOfCycles` at all (fully enumerated in Phase 2 — 23 real test files plus one incidental fixture-file
hit, review: architect), and every one of them is a real regression risk if silently missed rather than
migrated. Rate the work by the surface, per plan 0102's own instruction to do so.
**Blast radius:** **Published API — every `beFreeOfCycles()` consumer whose baseline or `.excluding()` pattern
names a cycle, and this is the second cycle-identity-affecting release for the same family within 8 days /
**13 releases** (0.52.0 → 0.59.1, re-measured from `CHANGELOG.md` directly — the original draft's "7" was
stale; review: architect).** Top row of
[ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6: guard the guard, adversarial review, mutate. The
tight-succession cost is real and is argued explicitly in **Release**, below, rather than assumed away —
0.52.0's own CHANGELOG "Known limits" section pre-announced this exact follow-up by name, which is the
strongest mitigation available and is cited there.

---

## Problem

`beFreeOfCycles` emits **one violation per strongly-connected component**, so `.excluding()` — which matches
`element`/`file`/`message`, not `identity` — can only waive an entire component. Measured, three ways:

**1. Our own historical flagship cycle.** Bug 0055's ground-truth table for
`[builders, conditions, helpers, predicates]` lists 6 distinct slice-pair edges (`builders→conditions`,
`builders→helpers`, `builders→predicates`, `conditions→helpers`, `helpers→builders`, `predicates→helpers`) —
not 4 (the member count) and not the 60 individual import _sites_ those edges are built from. Bug 0054's
waiver, `.excluding('[builders, conditions, helpers, predicates]')`, covered all 6 with one pattern. Today,
that waiver is gone (bug 0054's fix deleted it) — but the _mechanism_ that made it dangerous is unchanged
code, confirmed present in `src/conditions/slice.ts` right now.

**2. The pinned "known limit."** `tests/conditions/cycle-message-and-identity.test.ts`'s
`'KNOWN LIMIT: a new cycle inside an already-waived component is still absorbed'` test builds a 3-slice ring
(`a→b→c→a`, 3 edges) and the same ring plus a **genuinely new** edge `c→b` (4 edges — a real, additional
`b↔c` cycle). Measured by reading the fixture source directly: both graphs today produce **the same
`element` and the same `hashViolation`**. One waiver silently absorbs a structurally new architectural cycle.

**3. The mechanism is _doubly_ fail-open — a gap neither plan 0088 nor bug 0056 states.** `.excluding()`
matches literal `element`/`file`/`message` text; it never reads `ArchViolation.identity` (verified by reading
`execute-rule.ts`'s `applyFilters` line by line). Plan 0088's Phase 4 sketch talks only about "identity."
If a fix changed only `identity` (leaving `element` as today's sorted member list `[a, b, c, d]`), the
**baseline** hash would become edge-aware, but the **live** `.excluding('[a, b, c, d]')` pattern would
continue to match — and therefore continue to silently absorb — every future edge inside that component,
exactly as before. Both mechanisms read from the _same_ violation fields today (`identity` supersedes
`element::message` only for hashing; `.excluding()` never looks at `identity` at all), so a fix has to change
`element` too, or it fixes only the half nobody currently exercises (nobody in this repo has ever loaded a
cycle baseline; `.excluding()` is the mechanism bug 0054's own waiver actually used).

## Why per-edge, not per-site, and not "the closing edge"

Design question 1, resolved:

**Every internal edge of the SCC, not every underlying import statement.** `buildSliceDependencyGraph`
(`src/helpers/slice-graph.ts`) already deduplicates to one edge per `(fromSlice, toSlice)` pair — Tarjan's
adjacency list is built directly from that deduplicated set. So "edge" for a cycle is naturally a slice-pair
fact ("does `helpers` depend on `builders`"), not a per-file-and-line fact. This is a deliberate divergence
from `notDependOn`/`respectLayerOrder`'s `siteIdentity` (`src/conditions/slice.ts:190-237`), which correctly
reports **per site** — because those conditions ask "which imports are individually forbidden," where each
import is independently a violation. A cycle asks a different question: removing 17 of the 18 real
`builders→conditions` import sites (bug 0055's table) does not remove the `builders→conditions` **edge**, and
the cycle survives unchanged as long as any one site remains. Reporting per-site would multiply a barrel's
findings by its site count for a fact that only changes when the _edge itself_ disappears — a worse mismatch
between finding count and remediation unit than the one bug 0028 fixed for the dependency family, in the
opposite direction.

**Every internal edge, not a single "closing" edge — and this is provable, not a heuristic.** For a strongly
connected component, any edge `u→v` where both `u` and `v` are members necessarily lies on a cycle: because
the component is strongly connected, there is a path `v→…→u`, and that path plus the edge `u→v` closes a
cycle. So every edge the current code already searches over (`edges.filter(e => inCycle.has(e.from) &&
inCycle.has(e.to))`) is genuinely, verifiably "part of a cycle" — not an example, not a guess. Choosing a
_single_ canonical "the closing edge" instead would require a minimum feedback-arc-set computation, which is
NP-hard in general and, worse, non-canonical: different valid minimum sets exist for the same graph, and
which one an algorithm returns depends on traversal order — reintroducing exactly the order-dependence bug
0056 already fixed once, one layer up. [Bug 0055](../bugs/fixed/0055-a-cycle-finding-names-edges-that-do-not-exist.md)'s
own residual ("recovering a real path") is this plan's own load-bearing distinction: it deferred exactly
this "true minimal cycle" computation, for the same reason. This plan does not attempt it either — see
**Out of scope**.

**`element` becomes the edge itself, not a decorated form of it.** `element: \`${from} -> ${to}\``(e.g.`'helpers -> builders'`) — nothing else folded in. This was tempting to enrich with the member-list context
(e.g. `'[builders, conditions, helpers, predicates]: helpers -> builders'`), and it is wrong: doing so would
make _every_ edge's `element`move whenever the component's membership changes (a slice joining or leaving),
even for edges that did not themselves change — reintroducing a smaller-scale version of the exact defect this
plan fixes. Keeping`element` a pure function of the two slice names is what gives the fix its strongest
property, verified below.

**The minimal-diff property, verified by case analysis (not merely asserted):**

| What changes in the graph                                                  | What happens to existing edge-elements/identities                                        | What happens to `.excluding()` patterns naming the unaffected edges                                        |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A new slice joins the SCC                                                  | Unaffected edges' `element`/`identity` are byte-identical (pure function of `from`/`to`) | Still match; not falsely re-reported                                                                       |
| A new edge appears between two slices already in the SCC (bug 0056's case) | The new edge gets a new `element`/`identity`; no existing edge is touched                | Old patterns do not match the new edge — **reported**, closing the fail-open                               |
| A slice leaves the SCC (cycle narrows)                                     | That slice's edges disappear from the internal-edge list; other edges are unaffected     | Only the departed slice's exclusion patterns go stale (`Unused exclusion` warning); the rest keep matching |

This is strictly better than even a hypothetical "sorted member set, but one violation per edge" hybrid: it
means an edit that changes one edge in a six-edge component invalidates _one_ waiver line, not the whole
waiver — the opposite of plan 0088 Phase 1's original member-set design, which invalidated the _entire_
waiver on any membership change (that property was fine for triggering a review, but it is not what makes
a waiver mechanism trustworthy at scale).

## Why standalone, not folded back into plan 0088

Design question 2, resolved: **standalone**, following the exact precedent of plan 0083 Phase 3 splitting
into plan 0093 ("Split out of plan 0083 Phase 3 when that phase's two hard requirements shipped without it,"
`ROADMAP.md`). Reasons:

- Plan 0088's Phases 1–3 are **done** and shipped (v0.52.0). Re-opening that document to carry a fourth,
  unrelated-in-shape design (a loop-structure change plus a 24-file test migration plus its own migration
  story) would misrepresent a shipped plan as still-in-flight, and bury a large, independently reviewable
  change inside a document whose stated job ("decide what each finding IS") is already discharged.
- The scope here — a measured 27-call-site test ripple, a second published-API migration, a dedicated
  Release section arguing against plan 0102's two-phase-gate precedent, a sabotage matrix — is the size and
  rigor of a plan in its own right (matching plans 0102/0103's shape), not a phase.
- Plan 0088 stays in `plans/` (not moved to `plans/completed/`), exactly as plan 0083 did: its header updates
  to record the split, and `ROADMAP.md`'s row for it is corrected to stop describing Phase 4 as its own
  open item. See **Files changed**, below.

## Design decisions this plan resolves — a scannable recap

1. **Identity/element granularity**: one violation per internal SCC edge (a unique `(fromSlice, toSlice)`
   pair), never per underlying import site and never a single designated "closing" edge. Proven, not
   heuristic: every internal edge of an SCC lies on some cycle. See above.
2. **In scope here vs. folded into 0088**: standalone, matching the 0083→0093 precedent. See above.
3. **Second-migration justification**: argued explicitly in **Release**, below — single-release, not a
   two-phase gate, with the reasoning for why this differs from plan 0102's shape.
4. **`.excluding()` API shape**: **no new API.** The existing `.excluding()` already matches `element`, and
   making `element` edge-specific is sufficient — confirmed by reading `execute-rule.ts` and by the
   review-proposal skill's existing-code-survey discipline (checked `combinators.ts`, `rule-builder.ts`,
   `terminal-builder.ts`; nothing there is a parallel mechanism worth reusing here, and nothing new is
   needed). `excluding(...patterns)` is variadic (`terminal-builder.ts:288`), so a user accepting a whole
   tangled component writes **one call naming every printed edge** (`.excluding('a -> b', 'b -> c', ...)`),
   not one call per edge (corrected — review: product, who found the original draft said "one call per edge"
   in two places despite its own Test inventory already demonstrating the correct single-call usage) —
   mechanical, and deliberately not collapsed into a single whole-component pattern, per ADR-008 rule 3's
   corollary that an escape hatch is not automatically safer than none.

## Phase 1 — per-edge identity, element, and message in `beFreeOfCycles`

The change is inside the existing `for (const scc of sccs)` loop (`src/conditions/slice.ts:118-182`). Today,
`realEdge` picks `edges.filter(...).sort(...)[0]` — a single representative edge for the whole SCC. The fix
iterates the same filtered, sorted list instead of indexing into it, and moves the violation-push inside that
inner loop:

```ts
for (const scc of sccs) {
  // Unchanged: still the sorted member set, still bug 0056's fix — used for
  // membership context in the message, no longer for identity/element (plan 0104).
  const members = [...new Set(scc.map((i) => sliceNames[i] ?? ''))].sort(byCodepoint)
  const inCycle = new Set(members)

  // EVERY internal edge, not just the first — plan 0104. Provably meaningful: any
  // edge between two members of a strongly-connected component lies on some cycle
  // (the component's connectivity supplies the return path), so this is not an
  // approximation of "the" closing edge — bug 0055 already established there is no
  // single, order-independent answer to that question.
  const internalEdges = edges
    .filter((e) => inCycle.has(e.from) && inCycle.has(e.to))
    .sort((a, b) => byCodepoint(a.from, b.from) || byCodepoint(a.to, b.to))

  for (const edge of internalEdges) {
    // Same lookup the old code used for its single realEdge — through `graph`, so
    // the question/options this edge was found with cannot diverge from the ones
    // details are fetched with (the exact mismatch class slice-graph.ts's own
    // docstring warns about). Called once per edge rather than once per SCC: each
    // call walks `fromSlice.files`, which is cheap — the AST work underneath is
    // cached per file by `edgesOf` (module-edges.ts) regardless of call count.
    const details = graph.detailsFor(edge.from, edge.to)
    const site = [...details].sort(
      (a, b) =>
        byCodepoint(a.sourceFile.getFilePath(), b.sourceFile.getFilePath()) ||
        a.importLine - b.importLine,
    )[0]

    violations.push({
      rule: context.rule,
      // The edge ITSELF, not the component — plan 0104. `.excluding('helpers -> builders')`
      // now names exactly this fact and nothing else in the component. Deliberately NOT
      // decorated with the member list: folding membership in here would move every edge's
      // element whenever the component's shape changes, even for edges that did not
      // themselves change — see "Why per-edge" above for the case analysis this avoids.
      element: `${edge.from} -> ${edge.to}`,
      file: site ? site.sourceFile.getFilePath() : 'unknown',
      line: site ? site.importLine : 0,
      // A pure function of the two slice names — no path, no line, no message text.
      // Distinct prefix from the old `cycle::` scheme so an old-format baseline entry
      // cannot accidentally collide with a new-format one.
      identity: `cycle-edge::${edge.from}->${edge.to}`,
      // "Cycle detected" stays the leading words — tests/presets/cycle-claims-match-behaviour.test.ts
      // filters on `message.startsWith('Cycle detected')` and must keep matching.
      // The named edge is a real, substantiated fact for THIS finding (not an "e.g." example
      // of the component, as the pre-plan-0104 message had it) — every edge pushed here
      // provably closes some cycle, per the proof above.
      message: site
        ? `Cycle detected: "${edge.from}" ${edgeVerb(site.edge.kind)} "${edge.to}" at ` +
          `${site.sourceFile.getBaseName()}:${String(site.importLine)}, part of a cycle with: ` +
          `${members.join(', ')}`
        : // Unreachable given `graph`'s options/question binding — kept for the same
          // defensive reason the pre-plan-0104 code kept its own `'unknown'`/`0` fallback.
          `Cycle detected: "${edge.from}" depends on "${edge.to}", part of a cycle with: ` +
          `${members.join(', ')} (location unknown)`,
      because: context.because,
    })
  }
}
```

**Extend the file's existing historical docstring** (`src/conditions/slice.ts:25-48`, the `canonicalizeCycle`
history note) rather than replace it — the sorting history is still true and still relevant; add a paragraph
explaining that `members`/sorting now serves the _message_ only, and identity/element moved to the edge.

**The loophole this reopens, and why it gets a mechanical check, not just prose (review: devops + customer,
independently).** `.excluding(/builders, conditions, helpers, predicates/)` (a regex over the message's "part
of a cycle with: …" clause, not the exact `element` string) still matches every edge-violation's message in
that component, including new ones. This is the single most probable failure mode of this exact migration: an
adopter translating an old whole-component `.excluding('[builders, conditions, helpers, predicates]')` under
time pressure, facing N new red findings, reaches for a regex over the text they recognize (the still-present
membership clause) rather than N exact edge strings — silently and completely re-absorbing the fail-open bug
this plan exists to close, with **zero signal**. A `docs/upgrading.md` paragraph is not a control for that;
it's a note in the postmortem. Documenting-and-testing-the-hole (the original draft's approach) does not
close it — it only proves the hole exists.

**The mechanical check.** `execute-rule.ts`'s exclusion loop already tracks, per pattern index, whether it
matched anything (`matchedPatterns`, for the "Unused exclusion" warning). Extend it to also track, per
pattern index, the **distinct set of `element` values** among violations it matched **whose `identity` starts
with `'cycle-edge::'`** — a plain string-prefix check, so this stays family-agnostic in spirit (no cycle-
specific import into `execute-rule.ts`, just reading a field every violation already carries). After the
filter pass, alongside the existing "Unused exclusion" warning, emit a new one when that set's size exceeds 1:

```ts
// execute-rule.ts — inside the existing exclusion-processing block
const matchedPatterns = new Set<number>()
const matchedCycleEdges = new Map<number, Set<string>>() // NEW
const refusedPatterns = new Set<number>()
result = result.filter((v) => {
  if (v.bypassFilters) {
    /* unchanged */
  }
  const targets = [v.element, v.file, v.message]
  const matchIndex = exclusions.findIndex((pattern) =>
    typeof pattern === 'string'
      ? targets.some((t) => t === pattern)
      : targets.some((t) => pattern.test(t)),
  )
  if (matchIndex >= 0) {
    matchedPatterns.add(matchIndex)
    // NEW: only cycle-edge violations count toward this check — a plain
    // string-prefix read of a field every violation already has, not a
    // cycle-specific import.
    if (v.identity?.startsWith('cycle-edge::') === true) {
      const set = matchedCycleEdges.get(matchIndex) ?? new Set<string>()
      set.add(v.element)
      matchedCycleEdges.set(matchIndex, set)
    }
    return false
  }
  return true
})

exclusions.forEach((pattern, index) => {
  if (refusedPatterns.has(index)) {
    /* unchanged */
  } else if (!matchedPatterns.has(index) && !silentIndices.has(index)) {
    /* unchanged "Unused exclusion" warning */
  } else {
    // NEW
    const edges = matchedCycleEdges.get(index)
    if (edges !== undefined && edges.size > 1) {
      const sorted = [...edges].sort()
      writeStderr(
        `[ts-archunit] Exclusion '${String(pattern)}' in rule '${ruleId}' matched ${String(sorted.length)} ` +
          `distinct cycle edges (${sorted.join(', ')}). A pattern matching more than one edge silently ` +
          `absorbs any future cycle among the edges it matches — name each edge separately: ` +
          `.excluding(${sorted.map((e) => `'${e}'`).join(', ')}).`,
      )
    }
  }
})
```

This catches the loophole regardless of WHICH mechanism over-matches — a loose regex, an accidentally-broad
exact string (impossible for `element` by construction, since exact strings can only equal one edge, but
still possible via `file`/`message`), or a copy-pasted old-format pattern that happens to still match via
`message`. It fires on `check()`/`warn()` — the same surface a migrator is already looking at — not buried in
`doctor` output they may never run. It is a warning (`writeStderr`), not a blocking finding, matching this
mechanism's own existing "Unused exclusion" precedent one line above it: advisory, not a second unsuppressable
gate stacked onto an already-large migration.

**What this does not close, stated plainly rather than left implicit:** a pattern matching exactly one cycle
edge today that a FUTURE architectural change causes to also match a second, different edge (e.g., a regex
`/^helpers ->/` written to match one edge, later matching a second `helpers -> X` edge that didn't exist when
the pattern was written) is caught by this same check the moment that second edge appears — which is
precisely the "new cycle silently absorbed" case, now surfaced instead of silent. What it does NOT catch is
a pattern an author writes broad on day one and never revisits, if it happens to match only one edge until a
later change widens it — that case is caught retroactively, at the moment it becomes real, not preemptively.
That is an acceptable bound: it converts "permanently silent" into "surfaced the moment it matters," which is
the property that was missing.

## Phase 2 — migrate the existing test suite

This migration is **mostly self-auditing**, not a hand-maintained list: most of the 27+ measured call sites
are hard-coded literal assertions, so Phase 1 landing turns each affected one **red**, loudly, in
`npm run test`. **Not fully exhaustive, though — stated plainly rather than oversold** (review: testing found
two concrete counter-examples, both in `cycle-message-and-identity.test.ts` and named explicitly in the
worked template below): an assertion that reads only `found[0]` or compares two arrays _relatively_ rather
than against a hard-coded length stays green whether Phase 1 landed correctly or not, because both the old
and new selection happen to agree at index 0. The red-loop catches literal/hard-coded assertions reliably;
index-0-only and shape-relative assertions need to be widened by hand, and the two known instances are
flagged individually below so they aren't missed. The procedure:

1. Land Phase 1.
2. Run `npm run test`. Every failure is a site to migrate — this is the enumeration mechanism, not a grep
   list assembled from memory (ADR-008 rule 5's own corollary: enumerate from the diff/the run, not memory).
3. For each failing assertion, apply the mechanical rewrite: a single-SCC `.toEqual(['[a, b]'])`-shaped
   assertion becomes an assertion over **N** edge-element strings, where N is the internal-edge count of that
   fixture's graph (computable by reading the fixture's own import statements — already done for the four
   fully-audited files below, as a worked example for the rest).
4. Repeat until the suite is green with zero cycle-shaped test skips or deletions — a migrated test still
   asserts the same _intent_ (which cycles are detected, which are not) at the new granularity, never merely
   silenced.

**Fully audited, with the exact new expectations, as a worked template:**

- **`tests/conditions/cycle-message-and-identity.test.ts`** — all 7 tests touch this shape.
  - `'a 4-ring names its members and ONE REAL edge...'`: a clean 4-ring has exactly 4 internal edges
    (`a→b, b→c, c→d, d→a`). Rewrite to assert 4 violations, elements `['a -> b', 'b -> c', 'c -> d', 'd -> a']`
    (sorted-by-edge order), each message naming its own real edge — no more "(e.g. ...)" hedging language,
    since each is now a substantiated claim about that specific edge, not an example of the component.
  - `'...is LOCATED at a real edge, not unknown:0'`: assert **every** one of the 4 violations has a real
    `file`/`line`, not just `found[0]`. **This widening must be applied by hand at implementation time, not
    discovered by `npm run test`** (review: testing — as it stands today this test only reads `found[0]`,
    which is byte-identical under the old `edges[0]` selection and the new `internalEdges[0]`, so it stays
    green unmodified through Phase 1 and will NOT surface in Phase 2's red-loop; a concrete counter-example
    to "the suite enumerates the migration exhaustively," flagged so it isn't silently skipped).
  - `'...DETERMINISTIC, not filesystem-dependent'`: assert the **whole array** of 3 edge-elements/messages
    (not just one) is identical between forward- and reverse-declared slices. **Same caveat**: today's version
    compares relatively (`forward.map(...)` vs `reversed.map(...)`) with no hard-coded length, so it passes
    with 1-element arrays today and will keep passing with 3-element arrays after Phase 1 — legitimate either
    way, but also invisible to the `npm run test` red-loop and must be widened by hand.
  - `'a two-slice cycle still works'`: a 2-member SCC always has exactly 2 internal edges (`a→b`, `b→a` — the
    only possible route each way with no other nodes to pass through). Rewrite to assert 2 violations,
    `['a -> b', 'b -> a']` — this is the **smallest-blast-radius-looking case that is actually most affected**:
    every 2-slice cycle test in the suite doubles its violation count.
  - `'reordering imports changes neither the element nor the hash'`: unaffected in spirit — still true per
    edge — rewrite the array-shape assertions to per-edge.
  - `'...a member joining CHANGES it'`: rewrite to assert the **new** edges introduced by the 4th member get
    new `identity` **and** `element` values, while the pre-existing 3 ring edges' `identity` **and**
    `element` are both **unchanged** — this is the minimal-diff property from the table above, and this is
    the test that proves it rather than asserts it. **`element`, not only `identity`** (review: testing —
    `identity` and `element` are two independent expressions in Phase 1's code, so a sabotage that decorates
    `element` with the membership list while leaving `identity` alone passes an identity-only version of this
    assertion; both must be checked or the test doesn't catch the shape of defect Problem point 3 describes).
  - `'KNOWN LIMIT: a new cycle inside an already-waived component is still absorbed'` — **inverts**, per bug
    0056's own prediction ("the row inverts when granularity lands"). Rewrite: ring-only produces 3 edge
    violations; ring-plus-`c→b` produces 4, and the 4th (`c -> b`) has an `identity`/`element` that does not
    match any of the ring-only 3 — demonstrated by constructing a `.excluding()` chain naming only the 3 ring
    edges and asserting **both** that the 4th is still reported **and** that the filtered result's `element`
    array is exactly `['c -> b']` (i.e. the 3 ring edges are absent, not merely that a 4th exists alongside
    them). **The "still reported" half alone is not a live-suppression test** (review: architect + testing,
    independently — a completely no-op `.excluding()` would also leave `'c -> b'` "still reported," since the
    unfiltered set always contains it; the assertion has to check what got REMOVED, not only what remains).
    Rename the test to state the fix, not the limit.
- **`tests/conditions/type-only-cycles.test.ts`** — 9 of the file's `.toEqual(['[a...` sites. The
  `'MIGRATION: the option changes cycle membership...'` test (lines 208–239) needs a full rewrite: it
  currently asserts `element` moves from `['[a, b, c]']` to `['[a, b]']` when `c` drops out via
  `ignoreTypeImports`. Under this plan, the **a↔b edges' identities are unaffected** by `c` joining or
  leaving (per the minimal-diff table) — only `c`'s two edges (`b→c`, `c→a`) appear/disappear. Rewrite the
  test's own claim to what is now true: a member joining/leaving changes _only that member's_ edges, not the
  whole cycle's identity — and assert it via **both `hashViolation` and the raw `element` string** on the
  surviving `a→b`/`b→a` edges being byte-identical before and after (not `hashViolation` alone — same
  identity-vs-element gap as above), which is a **stronger** and more useful migration claim than the one
  this row previously proved.
- **`tests/conditions/re-export-edges.test.ts`** — 5 `.toEqual(['[a...` sites plus `expect(found).toHaveLength(1)`
  at line 649 (a 2-slice re-export cycle → now `toHaveLength(2)`). The 3-slice test at lines 597–627 (`b→c`
  re-export, `c→a` and `a→b` imports, one SCC) rewrites to 3 edge violations; its `narrower` sub-test
  (overriding `identity` to `'cycle::a,b'` to prove hash sensitivity) needs its constructed identity updated
  to the new `cycle-edge::` prefix or the comparison is vacuous (both sides already differ trivially by
  prefix alone — use a same-prefix, different-edge identity instead, e.g. `'cycle-edge::a->c'`, to keep
  proving what the row claims to prove).
- **`tests/conditions/verbatim-module-syntax.test.ts`** — 5 sites, all 2-slice cycles under
  `verbatimModuleSyntax`; each becomes 2 edge violations, same mechanical rewrite as above.

**Confirmed present, rewrite deferred to implementation** (found via `grep -rln "beFreeOfCycles" tests/`, not
yet line-by-line audited — stated honestly rather than claimed covered). Re-run and reconciled against the
24-file total this plan's header claims (review: architect — the original draft's itemized lists summed to
19, not 24; corrected here to name all 24): `tests/integration/workspace-per-package-options.test.ts`
(5 more `.toEqual(['[a...` sites), `tests/archunit/arch-rules.test.ts` (dogfood rule; currently 0 findings, so
likely unaffected, but re-verify after Phase 1), `tests/builders/slice-rule-builder.test.ts`,
`tests/core/diagnose.test.ts`, `tests/core/held-builder-is-immutable.test.ts`, `tests/core/config-findings-carry-their-own-remedy.test.ts`,
`tests/core/a-dead-discovery-glob-fails.test.ts`, `tests/core/assertion-gate.test.ts`,
`tests/presets/cycle-claims-match-behaviour.test.ts` (message-prefix check only, should survive unmodified —
verify), `tests/presets/import-options-forwarding.test.ts`, `tests/matrix/vacuity-classification.ts`,
`tests/cli/explain.test.ts`, `tests/models/slice.test.ts`, `tests/core/relative-globs-are-uniform.test.ts`,
`tests/docs/upgrade-rows-name-their-presets.test.ts`, `tests/conditions/slice-and-module-agree.test.ts`,
`tests/conditions/slice.test.ts` (distinct from `tests/models/slice.test.ts` above — same basename, different
directory), `tests/integration/baseline-portability.test.ts`, `tests/integration/slice-rules.test.ts`. That is
19 test files here plus the 4 fully-audited files below = 23; the 24th `grep -rl` hit,
`tests/fixtures/presets/layered-type-edge/src/services/order-service.ts`, is a fixture source file, not a
test — mentions the string incidentally and needs no rewrite. Step 2's `npm run test` loop is what makes this
list exhaustive in practice regardless of what's enumerated here in advance.

## Phase 3 — docs and the migration note

- **`docs/slices.md`** (lines 233–253): rewrite the cycle-output example for this plan's per-edge shape — a
  4-edge SCC producing 4 findings, each naming one real edge, stating the minimal-diff property (a membership
  change moves only the affected edges' identities). **Scope note, resolved by review** (Open Question 4):
  this section is ALSO already stale from v0.52.0 for an unrelated reason — it still shows the pre-0.52.0
  arrow-path message never updated when 0088 Phase 3 shipped. That pre-existing staleness is now **split into
  its own tiny, separate doc-only fix**, not folded into this plan's diff — this plan's edit here is scoped
  to the per-edge rewrite alone.
- **`docs/upgrading.md`**: the drafted row is in **Release**, below — not left to prose-description here.
  Content, summarized: affected population (`beFreeOfCycles()` + a cycle finding that is baselined or
  `.excluding()`-waived); the exact rewrite (`.excluding('[a, b, c, d]')` → one variadic
  `.excluding('a -> b', 'b -> c', ...)` naming every printed edge); the mechanical warning that now fires
  (Phase 1) if a migrator reaches for a loose regex over the message's membership clause instead, no longer
  merely a documented residual; the no-pre-upgrade-preview caveat; a baseline-specific recipe; and a pointer
  back to the 0.52.0 row for anyone jumping multiple releases at once (mirroring the "Why the order matters"
  0.27.0–0.29.0 skip-guidance already in that file — regenerate/rewrite once, on the version you land on, not
  once per intermediate release).
- **CHANGELOG.md**: new entry, `### Changed`, citing the 0.52.0 "Known limits" section by version number as
  the pre-announcement, with the measured before/after example (3 edges → 3 findings, not 1).

## Files changed

| File                                                                         | Change                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/conditions/slice.ts`                                                    | `beFreeOfCycles`: iterate every internal SCC edge instead of `edges[0]`; `element`/`identity`/`message` become per-edge (Phase 1); extend the existing historical docstring rather than replace it                                                    |
| `src/core/execute-rule.ts`                                                   | track distinct `element` values matched per exclusion pattern among `cycle-edge::`-identity violations; warn (`writeStderr`) when one pattern matches more than one distinct edge (Phase 1, Critical fix — the mechanical over-broad-exclusion check) |
| `src/helpers/baseline.ts`                                                    | `HASH_VERSION` bumped 4 → 5, with a history-comment entry matching the existing style (Critical fix — see "Why `HASH_VERSION` bumps" below)                                                                                                           |
| `tests/conditions/cycle-message-and-identity.test.ts`                        | all 7 tests rewritten to per-edge shape; the `KNOWN LIMIT` test renamed and inverted to prove the fix, with a live `.excluding()` demonstration asserting the ring edges are ABSENT from the filtered result, not only that the 4th edge is present   |
| `tests/conditions/type-only-cycles.test.ts`                                  | 9 confirmed sites; the `MIGRATION` test (208–239) rewritten to prove the minimal-diff property instead of "the whole element moves"                                                                                                                   |
| `tests/conditions/re-export-edges.test.ts`                                   | 5 confirmed sites plus the `toHaveLength(1)`→`toHaveLength(2)` site at line 649; the `narrower`-identity sub-test's constructed identity updated to the new prefix                                                                                    |
| `tests/conditions/verbatim-module-syntax.test.ts`                            | 5 confirmed sites, mechanical 2-edge rewrite                                                                                                                                                                                                          |
| `tests/integration/workspace-per-package-options.test.ts`                    | 5 confirmed sites, rewrite deferred to implementation (Phase 2's `npm run test` loop)                                                                                                                                                                 |
| remaining files listed under Phase 2's "confirmed present, rewrite deferred" | audited via `npm run test` after Phase 1 lands — exhaustive by construction, not by this table                                                                                                                                                        |
| `docs/slices.md`                                                             | cycle-output example rewritten for the per-edge shape (the unrelated pre-existing v0.52.0 staleness found while editing this file is split into its own separate doc-only fix, not this plan's diff — Open Question 4)                                |
| `docs/upgrading.md`                                                          | new row: affected population, exact `.excluding()` rewrite, the loose-regex warning, the skip-migration pointer to the 0.52.0 row                                                                                                                     |
| `CHANGELOG.md`                                                               | new `### Changed` entry citing 0.52.0's "Known limits" pre-announcement                                                                                                                                                                               |
| `plans/0088-a-slice-finding-identifies-itself.md`                            | Status/Phase-4 section updated to reference this plan instead of carrying the open question itself                                                                                                                                                    |
| `bugs/0056-a-cycle-identity-changes-when-imports-are-reordered.md`           | "The remaining fix" section's self-references to "plan 0088 Phase 4" updated to this plan's number                                                                                                                                                    |
| `plans/ROADMAP.md`                                                           | new open-work row; plan 0088's row corrected to stop describing Phase 4 as open under 0088                                                                                                                                                            |

No change to `src/helpers/slice-graph.ts`, `src/helpers/tarjan.ts`, `src/core/module-edges.ts`, or
`src/core/terminal-builder.ts` — `edgeVerb()` and `.excluding()`'s matching MECHANISM (which fields it reads,
how it compares them) are unchanged; only one producer's output shape moves, plus the `HASH_VERSION` constant
and one small addition to `execute-rule.ts`'s existing exclusion-processing loop (not its matching logic).

**Why `HASH_VERSION` bumps, correcting the original draft (Critical fix — review: devops).** The original
draft cited `HASH_VERSION`'s own history as grounds to leave it unbumped ("format-unchanged, input-moved").
That gets the precedent backwards: `src/helpers/baseline.ts:24-31` (the v4/bug-0012 bump) uses that _exact_
premise — "hashViolation's FORMULA is untouched and one of its inputs moved" — as the reason it **was**
bumped, because "the identity of existing entries actually changes... for that family and no other." Cycle
findings already carry a producer-set `identity` today (`cycle::${members.join(',')}`,
`src/conditions/slice.ts:178`) that this plan replaces wholesale with `cycle-edge::${from}->${to}` for
**every** existing cycle finding — precisely the "whole family, no other" shape v3 (bug 0028) and v4 (bug 0012) both bumped for. Bump to **5**, with a history-comment entry in `baseline.ts` following the existing
style (name the bug/plan, state which family moves, state that a baseline with no cycle entries is
byte-identical and keeps matching — matching v4's own "for that family and no other" framing exactly).

## Test inventory

**The historical 4-slice/6-edge shape produces 6 distinct violations, 6 distinct identities.** Reconstructed
from bug 0055's ground-truth table as a fixture (`builders`/`conditions`/`helpers`/`predicates` with the same
6 real edges) — the case this plan exists to fix, asserted at the granularity the fix targets.

**The KNOWN LIMIT test inverts, live, not just by hash — and proves REMOVAL, not just presence (review:
architect + testing, independently; this is Critical, not stylistic).** Ring-only (3 edges) vs. ring-plus-`c→b`
(4 edges): construct a rule with `.excluding('a -> b', 'b -> c', 'c -> a')` (naming only the ring edges) and
assert **both** (1) the filtered result's `element` array is exactly `['c -> b']` — the three ring edges are
**absent**, not merely "a fourth exists too" — **and** (2) unfiltered, all 4 edges are present. Asserting only
"`c -> b` is still reported" is not a live-suppression test: a completely no-op `.excluding()` would pass that
alone, since the unfiltered set always contains `c -> b`. The negative assertion (ring edges absent from the
filtered result) is what actually proves `.excluding()` is fail-closed, which is the whole point — a
hash-inequality check alone does not (see the doubly-fail-open finding in Problem).

**A 2-member cycle produces 2 independently-excludable violations.** Construct `a↔b`, assert 2 violations
(`'a -> b'`, `'b -> a'`), then `.excluding('a -> b')` and assert **both** that the filtered result's `element`
array is exactly `['b -> a']` (`'a -> b'` is absent, not merely that `'b -> a'` remains) **and**, unfiltered,
both are present — directly exercises the "waive one direction, not both" case this plan's whole premise
depends on, and avoids the same no-op-passes-too gap as the KNOWN LIMIT row above.

**The minimal-diff property, on a real fixture.** A 3-member ring plus a 4th slice joining via one new edge:
assert the 3 pre-existing edges' **`identity` AND `element`** values are byte-identical before and after the
join, and only the new edge(s) get new identities/elements — proves the table in "Why per-edge," not just
narrates it. Both fields, not identity alone (review: testing — `identity` and `element` are independent
expressions in Phase 1's code; a sabotage that decorates `element` with the membership list while leaving
`identity` alone — silently reintroducing the exact defect this plan closes — passes an identity-only version
of this test).

**A departing slice makes only its own edges stale.** The reverse of the above: start with 4 members, remove
one so the SCC narrows to 3; assert the 3 surviving edges' **`identity` AND `element`** are unchanged and only
the departed slice's edges disappear from the violation set.

**Determinism under reversed slice-declaration order, over the whole array.** Extends the existing test:
assert the full array of edge-elements/messages (not just index 0) is identical between forward- and
reverse-declared slices — the property that made the pre-0104 single-edge selection need a portability fix
in the first place (bug 0010) now has to hold for every edge, not just one.

**Location is per-edge, not shared.** Construct an SCC where two internal edges have _different_ real files
backing them; assert both violations' `file`/`line` independently point at their own edge's site, not both
at the same one (a regression this plan's per-edge loop could silently reintroduce by reusing a hoisted
`site` variable).

**Identity survives a message rewrite.** Change the message text in a test double and assert the hash is
unchanged — the same invariant plan 0088's own test inventory demanded for the original identity field,
re-proven for the edge-scoped one.

**The message still starts with `'Cycle detected'`.** Protects `tests/presets/cycle-claims-match-behaviour.test.ts`'s
existing `message.startsWith('Cycle detected')` filter, found by tracing that file, not assumed safe.

**The identity prefix is distinct, and it matters at the point of collision, not just in the abstract**
(review: testing — named as its own row, not left implicit inside another bullet). Construct a fake
old-format baseline entry with `identity: 'cycle::a,b,c'` alongside a real post-migration violation whose
`identity` is `cycle-edge::a->b`; assert `hashViolation` produces different hashes for the two, so an
old-format baseline entry cannot accidentally still "match" a new-format finding by coincidence.

**An over-broad exclusion is caught mechanically, not just documented (Critical fix — see Phase 1).** Two
rows: (1) a regex `.excluding(/builders, conditions, helpers, predicates/)` over a 4-edge component's messages
— assert `execute-rule.ts` emits the new `writeStderr` warning naming all 4 matched edges, not merely that the
regex "still matches" in the abstract; (2) a CONTROL — an exact-string `.excluding('a -> b')` that matches
exactly one cycle edge must NOT trigger the warning, and a broad exclusion in an unrelated family (a
`.excluding()` matching several `notDependOn` violations, say) must also NOT trigger it, proving the check is
genuinely cycle-scoped (via the `identity`-prefix read) rather than a generic "matched more than one thing"
warning that would false-positive across every other family's legitimate broad exclusions.

**VACUITY.** Every fixture above resolves real files in each slice before any cycle assertion runs, following
this file's own existing convention.

**Sabotage matrix** (each row must red):

| Revert                                                                                                                | Must red because                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revert to `edges[0]` only, one violation per SCC                                                                      | The KNOWN-LIMIT-inverted test reverts to absorbing the new edge — the exact defect this plan fixes                                                                                                                                                                                                                                                                                                                                                                |
| Change `identity` to be edge-specific but leave `element` as the whole sorted member list                             | The KNOWN LIMIT live-suppression test's NEGATIVE assertion reds — `.excluding('a -> b', ...)` no longer matches any `element` (still the whole member-list string), so all 4 edges remain in the filtered result, not just `'c -> b'`. **This row only reds because the test asserts the filtered array is exactly `['c -> b']`** — the earlier "assert `c -> b` is still reported" wording would NOT catch it (see the Critical fix to the Test inventory above) |
| Drop the `.sort()` on `internalEdges` before iterating                                                                | The reversed-declaration-order determinism test (whole-array form) reds — bug 0056's order-dependence returns one layer down                                                                                                                                                                                                                                                                                                                                      |
| Reuse a single hoisted `site`/`file`/`line` across all edges in one SCC instead of computing it per edge              | The "location is per-edge, not shared" test reds — two distinct edges report the same location                                                                                                                                                                                                                                                                                                                                                                    |
| Fold the member list into `element` (e.g. `'[a,b,c,d]: helpers -> builders'`)                                         | The minimal-diff test's `element` assertion reds (its `identity`-only predecessor would NOT have caught this — see the Critical fix above) — a membership change now moves every edge's element, not just the changed ones                                                                                                                                                                                                                                        |
| Drop `'Cycle detected'` from the message prefix                                                                       | `tests/presets/cycle-claims-match-behaviour.test.ts`'s existing filter finds 0 cycle findings — a real, pre-existing test this plan must not silently break                                                                                                                                                                                                                                                                                                       |
| Reuse the old `cycle::` identity prefix instead of `cycle-edge::`                                                     | The identity-prefix-distinctness test (Test inventory) reds — an old-format baseline entry and a new-format one could collide on adjacent content                                                                                                                                                                                                                                                                                                                 |
| Call `findSliceDependencyDetails` directly with fresh options instead of the bound `graph.detailsFor`                 | Location can point at the wrong question's answer — the same mismatch class `slice-graph.ts`'s own docstring warns produced `unknown:0` or a legal-import location historically                                                                                                                                                                                                                                                                                   |
| Skip the loose-regex residual test                                                                                    | The mechanical over-broad-exclusion check (Phase 1) goes unverified — a future change to `execute-rule.ts`'s matching logic could silently stop tracking `matchedCycleEdges`, and nothing would catch the warning disappearing                                                                                                                                                                                                                                    |
| Remove the `matchedCycleEdges` tracking or the `edges.size > 1` check in `execute-rule.ts`                            | The over-broad-exclusion warning test reds — a regex matching 2+ distinct cycle edges no longer produces the `writeStderr` warning, silently reopening the loose-regex loophole                                                                                                                                                                                                                                                                                   |
| Fire the over-broad-exclusion warning on ANY `.excluding()` pattern, not only ones matching `cycle-edge::` identities | A control test asserting a non-cycle multi-match exclusion (e.g. a legitimate broad `ignorePaths`-style pattern in an unrelated family) does NOT warn reds — the check must stay cycle-scoped or it produces false positives across every other family                                                                                                                                                                                                            |

## Release

**Single release, not a two-phase version-gated migration — argued, not assumed, and explicitly contrasted
with plan 0102's shape.** Plan 0102's diagnose-first/flip gate exists for a **new class of failure**: a rule
that has _never_ been able to fail becomes able to, which is exactly the shape ADR-008 rule 1's migration
corollary addresses (a warning-first release is invisible; a diagnose-first release is the honest version).
This plan is categorically different: `beFreeOfCycles()` already fails on cycles today, for every adopter who
has one. Nothing here makes a previously-always-green rule able to fail for the first time — it changes how
many findings **one already-firing check** produces and how they are individually named. That is the same
shape as CHANGELOG 0.57.0 ("findings that were hidden inside another finding's baseline entry are now
reported") and 0.52.0 (this exact family's own prior identity move) — both single-release, both shipped with
a "regenerate/rewrite, here is exactly what changes" note, neither gated.

**The "batch to pay once" precedent this plan breaks, confronted directly (review: customer — the original
draft argued around this rather than naming it).** 0.52.0's own CHANGELOG opens: _"The identity batch: four
filed items shipped together **so adopters pay one baseline regeneration instead of three.**"_ This plan
ships a fifth identity-moving change in the same family roughly 8 days / **13 releases** later
(0.52.0 → 0.59.1, `CHANGELOG.md` dates), asking the same adopter to pay a second time despite that explicit
promise. The rebuttal is not "this is fine" — it's that **the promise and this plan are answering different
questions.** 0.52.0's batching was about not charging the SAME migration cost repeatedly for reasons known
in advance (four defects, one root cause, fixed together). This plan is closing a **newly-provable,
previously-undischarged** fail-open (the "doubly fail-open" finding, Problem point 3) that 0.52.0's own
CHANGELOG explicitly deferred and named as coming ("Known limits," quoted below) — it is not the same
migration billed twice, it is a second, different, disclosed migration. That distinction is real, but it does
not erase the toil: two identity-format changes in under two weeks is a genuine adopter cost, weighed
honestly in Open Question 1 rather than argued away here.

**Sequencing against plan 0102 (review: product — flagged as a direct recommendation, not left implicit).**
Plan 0102 is independently queued at the same "High" priority in `plans/ROADMAP.md`, with zero coordination
stated between the two. Product's recommendation, which this plan adopts: **do not ship 0104 as an isolated
release sandwiched between other identity-moving work.** Either (a) bundle this release with plan 0102's
(one CHANGELOG entry, one `docs/upgrading.md` pass, one migration adopters absorb once), or (b) sequence it
explicitly after 0102 has shipped and settled, rather than landing independently on whatever schedule each
plan's implementation happens to finish. This is a release-management decision for whoever schedules the
work, not a design change to either plan — stated here so it is not lost between two documents that don't
reference each other's timing.

**The tight-succession cost, stated rather than hidden.** 0.52.0 shipped 2026-08-04; this plan would ship
roughly 8 days / **13 releases** later (re-measured directly from `CHANGELOG.md`; the original draft's "7"
was stale), in the same family. Three things make this acceptable, weighed against the cost named above
rather than in place of it:

1. **0.52.0's own CHANGELOG pre-announced it by name**, in its "Known limits" section: "Sorting cannot fix
   that; waiver granularity can (plan 0088 Phase 4). Pinned as a known-limit test row that will _invert_ when
   it lands." An adopter who read that release note was told a second cycle-identity change was coming, with
   the specific mechanism named (a test row that inverts) — this is disclosed, not a surprise. (Devops's
   finding stands, though: disclosure in an old release's changelog is not, by itself, an operational
   safeguard for someone who has already migrated past it — see the callout box below, which exists
   specifically to surface the warning at the point of impact instead of relying on someone re-reading an
   8-day-old entry.)
2. **Measured exposure is zero for this repository today**, and the affected population is narrow and
   self-identifying: only adopters who (a) call `beFreeOfCycles()`, (b) have at least one real cycle, and
   (c) have waived it via `.excluding()` or a baseline entry are affected at all. Everyone else's `check()`
   output is unchanged in substance (same cycles found, same slices named in the message) — only the
   `element`/`identity` fields move, which are invisible unless you match on them.
3. **The failure mode being closed is fail-open** — bug 0056's own framing, that this is "worse" than the
   fail-red half already fixed. Leaving a known, provable false-green live for another release cycle to avoid
   a second migration inverts this project's own stated priority (ADR-008: a check that cannot fail is worth
   less than no check, because it is counted as coverage).

**No pre-upgrade preview is possible for `.excluding()` consumers — a real departure from this project's
standard recipe, stated rather than left for a migrator to discover (review: customer).** `docs/upgrading.md`'s
general recipe runs `doctor`/`check` **on the old version first**, to see what's coming before committing.
That's structurally impossible here: the pre-upgrade code only ever computes and can only ever print **one**
representative edge per SCC (`edges.filter(...).sort(...)[0]`) — the other N−1 edges do not exist anywhere in
old-version output, not even as JSON. The new `docs/upgrading.md` row must say this explicitly, the same way
the 0.59.0 row says "install the new version first and run doctor before letting CI run check" for its own
structurally-impossible-to-preview case — this is the second release with that shape, and the row should say
so rather than silently omit the "preview first" step the file's general recipe otherwise promises.

**A drafted `docs/upgrading.md` row, not left to prose-description at implementation time** (review: customer

- devops, both asked for this to be committed now rather than deferred):

> **`0.??.0`** | **Yes — every `beFreeOfCycles()` finding's `element`/`identity` changes.** One violation per
> internal cycle edge, not one per whole tangled component (plan 0104) — a waiver naming the old
> `'[a, b, c, d]'` shape matches nothing after upgrading; it does not silently keep working, it goes
> **unused** (`Unused exclusion... it may be stale after a rename` — see the callout below for why that
> message is misleading here). | **No pre-upgrade preview is possible for `.excluding()` string patterns**
> (unlike every other row in this table) — the old version can only ever show you one representative edge per
> tangle, never the rest. **Baseline users**: regenerate on the **new** version, the same shape as 0.52.0 —
> every cycle baseline entry is orphaned by the `HASH_VERSION` bump (4 → 5), not just the changed ones, so
> there is nothing to compare against on the old version first. **`.excluding()` users**: upgrade, run
> `check()`, and replace each old whole-component pattern with one `.excluding()` call naming every printed
> edge string (`.excluding('a -> b', 'b -> c', ...)` — one call, multiple patterns, not one call per edge).
> **Do not reach for a regex over the old membership text** — `execute-rule.ts` now warns
> (`writeStderr`) when one exclusion pattern matches more than one distinct cycle edge, specifically to catch
> this. **Rollback:** pin to the last pre-0104 release while migrating, the same guidance this project gives
> for every other unsuppressable-until-fixed finding (0.59.0's floor).

**Version-bump reasoning, matching 0.59.0's explicit precedent rather than leaving the number unstated**
(review: devops — the original draft never engaged with 0.59.0 at all, the closest and freshest release with
this exact "no suppression, no preview" shape). Ship as a minor bump, not a patch, for the same reason
0.59.0 gave explicitly: pre-1.0, `^0.5x.0` resolves anywhere inside that minor range, so shipping an
identity-moving, baseline-orphaning change as a patch would reach every consumer silently on an unchanged
lockfile. `CHANGELOG.md`'s entry for this release should open with the same style of callout 0.59.0 used —
naming the affected population, the absence of a suppression flag, and the rollback line — rather than
requiring a reader to reconstruct it from prose scattered through this plan.

**docs/upgrading.md's row must give this the same detail level as its 0.57.0/0.58.0/0.59.0 neighbours**:
affected population, the exact `.excluding()` rewrite recipe, the mechanical warning that now exists for the
loose-regex case (Phase 1 — no longer merely documented, see above), a baseline-specific recipe, the
no-pre-upgrade-preview caveat, and a skip-migration pointer for anyone jumping from pre-0.52.0 straight to
this release (rewrite once, at the version you land on — mirroring the file's existing 0.27.0–0.29.0
guidance).

**No suppression-mechanism change.** `.excluding()`, baseline, `.asSeverity('warn')` all continue to work
exactly as before — only what a cycle finding's `element`/`identity` _say_ moves, plus the one new advisory
warning (Phase 1) that fires alongside the existing "Unused exclusion" warning. This is not a `bypassFilters`
change and not a new `DiagnosticFinding` kind.

## Out of scope

- **Recovering a real cycle path** (bug 0055's stated residual — "recovering a real path... needs a real-path
  implementation"). This plan proves every reported edge lies on _some_ cycle; it does not attempt to name
  _the_ minimal cycle through it, which is bug 0055's own deferred, separate problem.
- **A cap or summarizing finding for very large/dense SCCs — genuinely unresolved, not merely deferred**
  (review: customer + product). For K members in a near-complete tangle, internal edges approach K(K−1); this
  plan does not add a warning, a truncation, or a "this component has N edges, consider restructuring"
  meta-finding. Unlike the framing in the original draft, this is **not** purely speculative: customer's
  review verified against `src/core/format.ts`'s per-violation rendering (a full block per finding, code frame
  included by default) that N edges deterministically produce N full console blocks, each repeating the same
  membership clause — a real, inspectable property of this repo's own formatter today, not something
  requiring future adopter telemetry to notice. Product separately flagged that leaving this "unresolved"
  sits awkwardly next to this plan's own **top-row** ADR-008 rule-6 blast-radius claim, which argues for
  chasing guards deeper, not shallower. The mechanical over-broad-exclusion check (Phase 1) gives dense
  components a partial, incidental mitigation — a broad exclusion over a dense tangle is exactly the shape
  most likely to trip that warning — but it is not a substitute for bounding output volume itself. Left open
  deliberately rather than resolved unilaterally in this revision: a real fix here (de-duplicating the
  repeated membership clause across one batch of same-component findings in the terminal formatter, a display
  change customer suggested that would not touch `.excluding()`'s matching contract at all) is a legitimate
  option a reviewer should decide on, not one this plan should adopt without sign-off given its own
  blast-radius classification is what makes the gap uncomfortable.
- **A convenience method for waiving a whole component at once.** Deliberately not added — see "Design
  decisions," #4. An adopter who wants to accept an entire tangled component writes one variadic
  `.excluding()` call naming every printed edge; this is intentionally not collapsed into a single
  whole-component pattern, per ADR-008 rule 3's corollary that an escape hatch is not automatically safer
  than none.
- **Fixing the generic "Unused exclusion... it may be stale after a rename" message** to name an identity
  migration as a candidate cause (the way `unmatchedBaselineFinding` was fixed for baselines in bug 0060).
  This message is shared by every `.excluding()` use in the framework, not specific to cycles, and fixing it
  generically is a separate, larger piece of work than this plan's scope. `docs/upgrading.md`'s new row works
  around the gap by naming the real cause explicitly, rather than waiting on the message to say it.
- **Performance of calling `graph.detailsFor` once per edge instead of once per SCC.** Reasoned, not
  benchmarked: the per-file AST walk underneath is cached (`edgesOf`, `module-edges.ts`), so the added cost is
  bounded by iterating a slice's file list E times rather than the AST work itself. Per ADR-008 rule 6 ("an
  internal check over a corpus we control: guard the check, prove each detector fires once, then stop"), no
  dedicated performance test is added; if a real adopter measures a regression, that is new evidence this
  plan does not currently have.

## Related

- [Bug 0056](../bugs/0056-a-cycle-identity-changes-when-imports-are-reordered.md) — the bug this plan closes.
- [Bug 0055](../bugs/fixed/0055-a-cycle-finding-names-edges-that-do-not-exist.md) — same root cause; its
  residual ("recovering a real path") stays open and separate, see Out of scope.
- [Bug 0054](../bugs/fixed/0054-within-makes-helpers-depend-on-builders.md) — the disproven "fail-closed"
  claim this plan's mechanism actually delivers on.
- [Plan 0088](./0088-a-slice-finding-identifies-itself.md) — Phases 1–3 (identity infrastructure,
  message rewrite), which this plan builds directly on; Phase 4 splits into this document.
- [Plan 0102](./0102-a-detector-that-cannot-fire-says-so.md) — the two-phase gated-migration shape
  this plan deliberately does not use, with the distinction argued in Release.

## Open questions left for review, not resolved unilaterally

1. **Is a single-release migration actually the right call, given the tight 8-day/7-release succession with
   0.52.0?** The case above (categorically different failure shape than plan 0102's; pre-announced; zero
   current exposure) is made, but this is exactly the kind of judgment call ADR-008 rule 6 asks a reviewer to
   make deliberately rather than infer — architect/product sign-off is wanted specifically on this, not just
   on the mechanism.
2. **Should the message's "part of a cycle with: …" clause be restructured to make the loose-regex residual
   harder to hit by accident** (e.g., moving the membership list to a separate, more clearly "context, not the
   claim" position, or a structured field rather than free text) **— or is documenting and testing the
   residual, as this plan does, the right level of intervention?** Chosen: not re-shaping the message to
   defend against misuse, on the grounds that hiding useful context to prevent a bad regex is the wrong trade
   — but this is a genuine judgment call, not a settled one.
3. **The large/dense-SCC edge-count scaling question is genuinely unresolved**, not just deferred by policy —
   there is no real adopter's dense-SCC shape to measure against, so "is N(N-1) internal edges ever actually
   produced in practice, and is that a usability problem" is an honest unknown, not a claim.
4. **Resolved by review: split out.** `docs/slices.md`'s pre-existing v0.52.0 staleness (found while doing
   this plan's own doc edit) moves to its own tiny, separate doc-only fix rather than riding in this plan's
   diff — both architect and product leaned toward isolating it so this plan's diff stays purely about the
   mechanism, and a doc-only fix has no reason to wait on this plan's review/implementation timeline. Removed
   from this plan's Files Changed table accordingly.
