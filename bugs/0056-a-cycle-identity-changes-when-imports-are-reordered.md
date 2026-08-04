# Bug 0056: a cycle's identity changes when imports are reordered

**Reported:** 2026-08-04 · **Fixed:** **half** — the fail-red half shipped in v0.52.0; the fail-open half is still open, see below
**Found in:** every version since `beFreeOfCycles` shipped — latent until
[plan 0084](../plans/completed/0084-cycle-detection-that-ignores-type-only-imports.md) put
`arch/no-cycles` at `.check()` and told users to baseline cycle findings.
**Severity:** **High.** A cosmetic edit reds CI, and the diagnostic it prints sends the reader after a
cause that does not exist. Also silently fail-OPEN in the other direction, which is worse.

## What

A cycle violation's `element` is the SCC member list in DFS-pop order, and that order is an artifact of
traversal rather than of the graph. So the identity moves when the source does not.

Measured. Real edges `a→b`, `a→c`, `b→c`, `c→a`, with the cycle accepted by identity exactly as
`tests/archunit/arch-rules.test.ts` does it:

```
imports as written        -> element '[a, c, b]'   exclusion matches   GREEN
the two imports in a/index.ts swapped
                         -> element '[a, b, c]'   exclusion stale     RED
```

Nothing was added or removed. That is the edit "organize imports" performs. And the diagnostic reads:

```
[ts-archunit] Unused exclusion '[a, c, b]' ... it may be stale after a rename.
```

No rename happened. The reader is sent after the wrong cause, which is ADR-008 rule 2's failure in the
_advice_ rather than in the finding.

## The other direction is worse

An SCC **absorbs** new intra-component edges without changing its name. Measured on a 4-member
component: adding a brand-new cycle between two slices _already in_ it leaves the element string
byte-identical, so an existing exclusion silences it.

Our own waiver covers `[builders, conditions, helpers, predicates]` — **4 of the 6 gated slices** — so
any new cycle confined to those four is now invisible. [Bug 0054](./fixed/0054-within-makes-helpers-depend-on-builders.md)
claims _"any other cycle now fails the build"_ and `tests/archunit/arch-rules.test.ts` claims the
exclusion is _"the fail-closed direction"_. Both are false, and both need correcting when this is fixed.

Underneath sits a published-API gap: `beFreeOfCycles` emits **one violation per SCC**, so `.excluding()`
can only waive a whole component. There is no way to waive _the `helpers/within.ts → builders` edge_ and
keep the rest red. That is fail-open by construction and belongs to
[plan 0088](../plans/0088-a-slice-finding-identifies-itself.md).

## Why `canonicalizeCycle` does not already fix this

It rotates so the lexicographically smallest member leads, which is enough for bug 0010's simple-cycle
case. Rotation cannot canonicalise a **set** whose stored order is a DFS artifact — and `[a, c, b]` vs
`[a, b, c]` are both already rotated to start at `a`.

## Fix

**Sort the member list.** For an SCC the order carries no information — see
[bug 0055](./fixed/0055-a-cycle-finding-names-edges-that-do-not-exist.md), where printing it as a path is the
bug — so sorting loses nothing and makes the identity a function of membership alone.

That deliberately reverses `canonicalizeCycle`'s stated reason for preserving direction. That reason is
sound _only if_ the array is an edge-ordered path; 0055 establishes it is not. If 0055 is fixed first by
recovering a real path, revisit — a genuine path's direction IS information, and then the identity should
be the sorted member set with the path carried in the message.

**Migration:** sorting changes `element` for every cycle of ≥ 3 members, so cycle baselines and
`.excluding()` patterns move once more. Say so; do not ship it quietly. It is the last such move if it
lands with plan 0088.

## Test inventory

1. **Reordering two imports does not change the element**, by identity. The row that reds today.
2. **A new cycle between two slices already in a waived component is REPORTED.** The fail-open half, and
   the more important row.
3. **A 2-member cycle's element is unchanged by this fix**, so existing baselines for the common case
   survive.
4. **The `.excluding()` example in `arch-rules.test.ts` still matches**, and its "fail-closed" comment is
   corrected to what is actually true.
5. **VACUITY: the reorder fixture really produces the same graph** — assert the edge set before and
   after, or the row proves only that two different graphs differ.

## Related

- [Bug 0055](./fixed/0055-a-cycle-finding-names-edges-that-do-not-exist.md) — same root cause.
- [Plan 0088](../plans/0088-a-slice-finding-identifies-itself.md) — per-edge identity, which retires the
  whole-component waiver.
- [Bug 0054](./fixed/0054-within-makes-helpers-depend-on-builders.md) — its fail-closed claim is disproven here.

## Half shipped in v0.52.0

**The fail-RED half is fixed.** The SCC member list is now **sorted** rather than rotated, so the element
is a function of membership alone. Reordering two imports no longer changes it, no longer reds CI, and no
longer prints "it may be stale after a rename" about a rename that never happened. `canonicalizeCycle` was
deleted — sorting subsumes rotation for a set — and its reasoning is preserved at the site, including why
its "direction is information" premise was false for any component of three or more.

**The fail-OPEN half is NOT fixed, and sorting cannot fix it.** It is not an ordering problem:
`beFreeOfCycles` emits **one violation per SCC**, so a new edge between two slices already in a component
leaves the member set byte-identical and any existing `.excluding()` or baseline entry silences it.

That is pinned as a **known limit** in `tests/conditions/cycle-message-and-identity.test.ts` — a row that
builds a ring, then the same ring plus a genuinely new `b↔c` cycle, and asserts the two produce the same
identity. It is written as a limit rather than a fix so the row _inverts_ when granularity lands.

The blast radius shrank in the same release: [bug 0054](./fixed/0054-within-makes-helpers-depend-on-builders.md)
was fixed and our own four-slice waiver deleted, so nothing in this repository is currently absorbed. The
mechanism remains for any adopter who waives a component.

**The remaining fix is waiver granularity** — one finding per offending _edge_, or an exclusion that can
name an edge — which is [plan 0088](../plans/0088-a-slice-finding-identifies-itself.md) Phase 4. This bug
stays open until that lands.
