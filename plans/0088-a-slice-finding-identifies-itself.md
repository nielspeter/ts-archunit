# Plan 0088 — a slice finding identifies itself

**Status:** **Phases 1–3 DONE (v0.52.0). Phase 4 (waiver granularity) not started** — it is bug 0056's remaining fail-open half. Filed 2026-08-04, Filed 2026-08-04 from the five-persona review of v0.47.0–v0.49.0, where
three reviewers reached the same conclusion from different directions.
**Priority:** High. It is the keystone: three filed bugs cannot be fixed properly until it lands, and one
of them is a live false green.
**Effort:** Medium. The mechanism is one field; the work is choosing what each finding's identity _is_ and
migrating the baselines once.
**Blast radius:** **Published API and every existing slice baseline.** `ArchViolation.identity` is what
`hashViolation` keys on, so setting it moves every slice finding's hash — deliberately and once. Top row of
[ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6: the migration needs a stated, tested remedy,
and the identity chosen needs to be the one we want for years.

## Problem

No slice condition sets `ArchViolation.identity`, so `hashViolation` falls back to
`` `${element}::${message}` ``. That single fact causes three separate defects:

**1. Barrel findings collapse to one baseline entry.** `notDependOn` and `respectLayerOrder` push one
violation _per dependency site_, with `element` = the file's basename and a message naming only the slice
pair. Measured: a barrel with three re-exports into one forbidden slice produces **3 findings at lines 1, 2
and 3 — and 1 distinct hash.** `isKnown` is set membership, so one baseline entry suppresses all three.

This is [bug 0028](../bugs/fixed/0028-two-findings-in-one-file-can-share-a-baseline-identity.md)'s shape, in
the family that never got the fix. `docs/upgrading.md`'s own 0.28.0 row says it plainly for the dependency
conditions: _"**Do not baseline a barrel**: 46.5% of its findings share an identity with a sibling, so
accepting one accepts the rest."_ v0.48.0 is the release that made barrels _slice_-dependency-bearing, so
the warning now applies to a family that has no `identity` and no warning.

**2. The cycle message cannot be improved.** The message text is _in_ the hash, so rewording
`Cycle detected: a -> b -> a` invalidates every cycle baseline. That blocks
[bug 0055](../bugs/fixed/0055-a-cycle-finding-names-edges-that-do-not-exist.md), whose whole fix is a better
message — and it means the message we shipped by accident is the message we are stuck with.

**3. The cycle identity carries traversal order.** `element` is the SCC member list in DFS-pop order, so it
changes when imports are reordered ([bug 0056](../bugs/0056-a-cycle-identity-changes-when-imports-are-reordered.md)).
An identity that is not a function of the graph is not an identity.

## Phase 1 — decide what each finding IS

This is the whole plan; the code is downstream of it. One line per condition, and each must survive the
question _"what edit should change this, and what edit should not?"_

- **`beFreeOfCycles`** — the identity is the **sorted member set**: `a,b,c`. Not the order (bug 0056), not
  the message (defect 2). A cycle that gains or loses a member is a different finding; the same cycle
  reported with a better message is not.
- **`notDependOn`** — one finding per **site**, so the identity must include the site: something like
  `from→to@relpath:line`. Line numbers move when code above them moves, which is the objection —
  but the alternative is today's collapse, and the dependency family already resolved this trade the same
  way in v0.28.0. Follow whatever `src/core/module-edges.ts`-based conditions do, and follow it exactly
  rather than inventing a second scheme.
- **`respectLayerOrder`** — same as `notDependOn`, plus the layer pair.

**Check `normalizeIdentityText` before choosing.** `hashViolation` scrubs a repository root out of identity
text when `root` is set; an identity containing an absolute path must go through that or it will not be
portable, which is the hazard `docs/upgrading.md` already documents.

## Phase 2 — set it, and migrate once

Add `identity` at the three producers. Then the migration note, which has to be blun: **every slice
finding's baseline hash changes, once.** That is the price of the three fixes and of never paying it again.

`HASH_VERSION` exists for exactly this — check whether this qualifies as a format change (it does not; the
format is unchanged, an input moved) and if not, make sure the "0 of N matched" diagnostic explains _this_
cause rather than guessing the repository root, which is
[bug 0060](../bugs/0060-a-pattern-change-silently-invalidates-every-baselined-finding.md).

## Phase 3 — spend the freedom

With identity separated from message, the message becomes editable. Do it in the same release or the
migration is paid twice:

- Name the **closing edge and its kind**: `Cycle detected between a, b (closed by a re-export at
src/barrel.ts:3)`. `edgeVerb()` already returns `'re-exports'` and no slice condition uses it.
- Say **why** an edge counted, where the answer is non-obvious: under `verbatimModuleSyntax`, a cycle
  through `import { type X }` is baffling without one clause of explanation.
- `docs/slices.md` **already documents a per-edge listing that has never existed** — the v0.49.1 sweep
  labelled it as aspirational rather than deleting it. This phase is where that prose becomes true.

## Phase 4 — waiver granularity

`beFreeOfCycles` emits one violation per SCC, so `.excluding()` can only waive a **whole component**. Ours
covers 4 of 6 gated slices, which means a new cycle among those four is silently accepted
(bug 0056's fail-open half). Once a cycle finding names its closing edge, an exclusion can name that edge
instead — which is what [bug 0054](../bugs/fixed/0054-within-makes-helpers-depend-on-builders.md)'s waiver
actually wants and cannot express.

Decide deliberately whether this is in scope here or its own plan; it is the difference between a waiver
that is fail-open by construction and one that is not.

## Test inventory

1. **Three sites in one barrel produce three distinct hashes.** Reds today; it is defect 1.
2. **One baseline entry suppresses exactly one of them** — the consequence, asserted through `isKnown`
   rather than inferred from the hash.
3. **A cycle's identity is stable under import reordering**, and **changes** when a member joins or leaves.
   Both directions, or the identity is either frozen or meaningless.
4. **The identity survives a message rewrite**: change the message text in the test and assert the hash is
   unchanged. That is the property Phase 3 depends on, and the only row that proves it.
5. **`root`-relative portability**, if the identity contains a path — generated under one root, matched
   under another.
6. **VACUITY: the baseline actually contained entries** for each row; a 0-of-0 match is not the case under
   test.
7. **The migration note is measured, not hoped**: before/after hashes for each of the three conditions,
   asserted through the real `hashViolation`. Plan 0084 shipped a wrong migration note precisely because
   this row was omitted.

## Out of scope

- **Fixing the cycle _path_ computation.** That is bug 0055; this plan only unblocks it.
- **Changing what counts as an edge.** Bug 0059.
- **`HASH_VERSION` semantics.** Read it, do not redefine it.

## Related

- [Bug 0055](../bugs/fixed/0055-a-cycle-finding-names-edges-that-do-not-exist.md),
  [0056](../bugs/0056-a-cycle-identity-changes-when-imports-are-reordered.md),
  [0060](../bugs/0060-a-pattern-change-silently-invalidates-every-baselined-finding.md) — the three this
  unblocks.
- [Bug 0028](../bugs/fixed/0028-two-findings-in-one-file-can-share-a-baseline-identity.md) — the same
  collapse, already solved once for another family.
- `src/helpers/baseline.ts` (`hashViolation`, `normalizeIdentityText`, `HASH_VERSION`),
  `src/conditions/slice.ts`, `src/core/violation.ts`.
