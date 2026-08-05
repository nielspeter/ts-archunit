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

Measured. The first version of this report showed `beImported findings=1`, which demonstrates the missing
identity but **cannot** demonstrate a collision, and then asserted one for the whole family in its title.
Both conditions were re-measured on the right fixtures, and a third was found in the same file:

| condition                      | fixture                                              | result                             |
| ------------------------------ | ---------------------------------------------------- | ---------------------------------- |
| `onlyBeImportedVia`            | two importers named `consumer.d.ts`, sibling folders | **2 findings / 1 hash** — collides |
| `beImported` / `noDeadModules` | two orphan `index.ts` files, sibling folders         | **2 findings / 1 hash** — collides |
| `haveNoUnusedExports`          | two `index.ts` with an unused export each            | **2 findings / 1 hash** — collides |

`identity` is `undefined` in all three, and the messages are byte-identical because they are built from
the basename (`"index.ts is not imported by any other module"`).

**`noDeadModules()` is the exposure that matters, and the first version of this report never named it.**
That is the published name — it is what appears in `docs/modules.md`, in the presets, and in most people's
rule files. A dead-module sweep is _precisely_ the population full of same-basename files: `types.ts`,
`index.ts`, `utils.ts`, `constants.ts`. Baseline one dead `types.ts` and every future dead `types.ts`
anywhere in the repo is pre-accepted, permanently and silently. Sharper still: `beImported`'s own docstring
recommends `.excluding('index.ts', 'main.ts')`, so the condition's documented usage points straight at the
colliding population.

This is exactly what bug 0063 fixed for the dependency family (_"two sibling folders each with an
`index.ts` importing the same target produced ONE identity for TWO violations"_) and what plan 0088 fixed
for the slice family. The reverse family has never had `identity` set, so it never got either fix.

## How wide is this really

Wider than "the reverse family", and the honest answer is that **nobody should trust a hand-count here**.
Across five reviews the number of affected producers was given as 2, then 7, then 37, then 5, then 9,
because the coverage is partial _within_ files and every counting method draws a different line. The
narrowest defensible reading — push sites that use a **basename** as `element` and set no `identity`:

| file                                     | sites                           |
| ---------------------------------------- | ------------------------------- |
| `src/conditions/reverse-dependency.ts`   | 3                               |
| `src/conditions/cross-layer.ts`          | 2                               |
| `src/conditions/exports.ts`              | 2 (`:22`, `:52`; `:94` has one) |
| `src/conditions/body-analysis-module.ts` | 2 (`:33`, `:126`)               |

**So the fix should not ship against a list.** Derive the census from source: a rule over
`src/conditions/` asserting every `ArchViolation` producer sets `identity`, which ts-archunit can enforce
on itself. That converts this bug from a fix into a guard, makes the eighth instance impossible to ship
silently, and removes the need to trust any number above. It is the same discipline as
`scan-enforceable-primitives.ts` — _a guard whose list is hand-written cannot fail when the list goes
stale_, and this list went stale five times in one afternoon.

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

## The migration is a choice, not a necessity — the original claim here was FALSE

This report first said: _"there is no empty-discriminator trick available: the current value is a composed
string, not an absent one, so nothing can reproduce it byte-for-byte while also fixing the collision."_
That is wrong, and it was the sole justification offered for a migration release.

`hashViolation` reads ``violation.identity ?? `${violation.element}::${violation.message}` ``. The fallback
is composed **from fields the producer already holds**, so setting `identity` to exactly
`` `${element}::${message}` `` is byte-identical — in `hashViolation` and in `hashSubject` alike. Apply the
collision-suffix construction on top (append a discriminator only where that string is **duplicated within
the run**) and the collision closes with **zero migration**.

So the real decision is:

| option                                           | migration | durability                                                        |
| ------------------------------------------------ | --------- | ----------------------------------------------------------------- |
| `identity = element::message` + collision suffix | **none**  | stays message-fragile — a reworded message invalidates entries    |
| a durable identity (full paths)                  | one       | survives rewording, which is why the forward families moved to it |

Both are defensible. Note the message-fragility of option 1 is **already true today**, so nothing is lost
by taking it; and note that option 2's migration buys the ability to fix the message, which is worth
something here (see below). What is not defensible is asserting option 1 does not exist — an unverified
derivation used to force a migration, which is the ADR-008 rule 5 shape this report is otherwise careful
about.

## The identity scheme first proposed is unimplementable — three reasons

It said: _"the full path of the importer, the edge kind, and the resolved target."_ Every clause has a
problem:

1. **`edge.kind` is not in scope.** The reverse graph is `Map<string, SourceFile[]>` — it stores
   **importers, not edges** — so at the violation site there is no edge to take a kind from.
2. **The kind is ambiguous by construction.** `addToGraph` dedupes on `(importer, target)` **across
   kinds**, so an importer that both `import`s and `require`s one target is a single graph entry with no
   single kind.
3. **It does not fit `beImported` at all.** That condition fires only when `importers.length === 0` — there
   is no importer, no kind and no target, only an orphan.

Workable instead, and it is two schemes because these are two differently-shaped findings:

- `onlyBeImportedVia` / `haveNoUnusedExports` → `importerPath::targetPath`, **no kind component**. The
  `(importer, target)` dedupe is what makes this sufficient: one edge per pair means no discriminator is
  needed at all, unlike the forward families. That makes the reverse family the one place a _purely
  declarative_ identity is available.
- `beImported` / `noDeadModules` → the **subject's** own full path. There is nothing else at that site.

## Fix the message in the same release

`onlyBeImportedVia` prints the importer by **basename** and locates every finding on the _target_, line 1.
Measured, two colliding findings are identical on screen:

```
/src/target.ts | target.ts | target.ts is imported by consumer.ts which does not match [**/index.ts]
/src/target.ts | target.ts | target.ts is imported by consumer.ts which does not match [**/index.ts]
```

After the identity fix the baseline can tell them apart and the terminal still cannot — the reader cannot
see which importer to go fix. Once `identity` is set the message no longer feeds the hash, so changing it
is **free then and costs a second migration later**.

One constraint the fix must respect: `.excluding()` matches against `[element, file, message]`, so leave
`element` alone — promoting it to a full path would silently break every `.excluding('index.ts')` in the
wild. Changing the _message_ does break an exact-string message exclusion, but that surfaces as an unused
pattern warning rather than failing open, so it is acceptable — say so in the upgrading row.

## Release sequencing — do NOT batch with 0064

This report originally suggested batching with
[bug 0064](./0064-a-dependency-identity-collides-across-two-spellings-of-one-module.md) on v0.52.0's
precedent. That precedent does not transfer, because v0.52.0's four fixes all moved identities **in the
same direction** — one row, one action.

These two are opposite. 0064's fix moves **nothing** (measured 3 of 975, all of them entries that were
already wrong); 0065's option 2 moves **everything** in its family. Batched, the upgrading row must say
"regenerate" and "do not regenerate" in one cell, scoped to different rule families — reproducing the
two-conflicting-actions defect that v0.56.0 was just cleaned up to remove. The cost to an adopter is not
the number of releases, it is the number of unambiguous instructions.

Ship 0064 first (its instruction shape is identical to v0.56.0's, which is now published and live), then
this one alone, rescoped to the whole identity-less class and carrying a single regenerate-after
migration.
