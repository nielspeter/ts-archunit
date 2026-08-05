# Bug 0065: reverse-dependency findings carry no identity, so two collide on a shared basename

**Reported:** 2026-08-05 · **Fixed:** not yet
**Found in:** pre-existing. Surfaced while settling whether `require()` identities move in v0.56.0 — they
do not, and the reason is this defect.
**Severity:** High. The same class as [bug 0063](./fixed/0063-a-dependency-identity-collides-across-files-sharing-a-basename.md)
and [plan 0088](../plans/0088-a-slice-finding-identifies-itself.md), both of which were fixed for their
own families and neither of which reached this one. Blast radius is the baseline identity string on disk
— the top row of [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6.

## What happens

`onlyBeImportedVia` (`src/conditions/reverse-dependency.ts`) and `beImported` push `ArchViolation` objects
with **no `identity` field at all**. `hashViolation` therefore falls back to the composed
`rule::element::message` form, and `element` is a **basename**. Two importers in different folders that
share a filename collapse to one baseline entry.

Measured — two importers named `consumer.d.ts` in sibling folders, both reaching the same target:

```
REVERSE onlyBeImportedVia   findings=2  identity=undefined  distinctHashes=1   *** COLLISION ***
REVERSE beImported          findings=1  identity=undefined
```

One accepted entry suppresses both, and the second importer is a dependency nobody approved.

This is exactly what bug 0063 fixed for the dependency family (_"two sibling folders each with an
`index.ts` importing the same target produced ONE identity for TWO violations"_) and what plan 0088 fixed
for the slice family. The reverse family has never had `identity` set, so it never got either fix.

## Why it surfaced now, and what it settles

The v0.56.0 review asked whether `require()` baseline identities move, since `require` is a names-less
kind and `edgeDiscriminator` changed. The answer is that **there is no `require` identity to move**, for
two independent reasons:

- No _forward_ condition counts `require` (`FORWARD_EDGE_KINDS.require === false`).
- The _reverse_ conditions do count it — and set no `identity`, so the discriminator is never consulted.

`edgesOf` does compute an ordinal for `require`, and `edgeDiscriminator` would return `''`/`#1` for it,
but nothing identity-bearing ever asks. It is unreachable by construction rather than by accident:
`addToGraph` dedupes on `(importer, target)`, so the reverse family sees **one** edge per importer however
many spellings the file uses.

So `tests/conditions/identity-does-not-move.test.ts` is correct to be silent about `require`, and that
silence should not be read as a coverage gap by whoever reviews it next. Recorded here because the
question will be asked again.

## The fix is not free, and that is the decision

Setting `identity` on reverse findings **moves every existing reverse baseline entry**, because the hash
switches from `rule::element::message` to the identity field. Unlike v0.56.0's fix there is no
empty-discriminator trick available: the current value is a _composed_ string, not an absent one, so
nothing can reproduce it byte-for-byte while also fixing the collision.

That makes this a migration release for anyone baselining `beImported` or `onlyBeImportedVia`, and the
migration must be stated in `docs/upgrading.md` with the regenerate-after-upgrading ordering — the reverse
of the page's headline rule, for which the 0.31.0 row is the precedent.

The identity should follow the two schemes that already exist rather than inventing a third: the full path
of the _importer_ (not the basename — that is the whole defect), the edge kind, and the resolved target.
Note the dedupe in `addToGraph` means one edge per `(importer, target)` pair, so no discriminator is
needed beyond that, unlike the forward families.

Consider fixing this together with [bug 0064](./0064-a-dependency-identity-collides-across-two-spellings-of-one-module.md)
so adopters pay one baseline migration rather than two — the precedent is v0.52.0's _"Four fixes were
batched deliberately so you pay that once rather than three times."_
