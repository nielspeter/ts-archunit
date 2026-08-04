# Bug 0055: a cycle finding names edges that do not exist, and cannot locate itself

**Reported:** 2026-08-04 · **Fixed:** not yet
**Found in:** every version since `beFreeOfCycles` shipped (plan 0012) — but **latent** until
[plan 0084](../plans/completed/0084-cycle-detection-that-ignores-type-only-imports.md) moved
`arch/no-cycles` to `.check()` and
[plan 0085](../plans/completed/0085-the-slice-graph-cannot-see-a-re-export.md) made multi-member
cycles the normal case.
**Severity:** **High.** A finding that fails a build, whose message asserts dependencies that are not
in the source and whose location is either a legal import or nothing at all. Three of four reviewers
found it independently.

## What

`src/conditions/slice.ts` prints a strongly-connected **component** as if it were a **path**:

```ts
const cycleNames = canonicalizeCycle(scc.map((i) => sliceNames[i]))
const cyclePath = [...cycleNames, cycleNames[0]].join(' -> ')
```

An SCC is a _set_. `tarjanSCC` pops in reverse-finish order, so the array is roughly the reversed
traversal — and for three or more members it is not a traversal at all.

Measured on a clean ring, `a → b → c → d → a`:

```
Cycle detected: a -> d -> c -> b -> a
unknown:0
```

**Every arrow is reversed**, and there is no location. Measured on this repository's own
`arch/no-cycles` rule:

```
message : Cycle detected: builders -> conditions -> helpers -> predicates -> builders
location: src/builders/call-rule-builder.ts:24
```

Ground truth for that component, enumerated from the same project:

| edge                    | sites                                              |
| ----------------------- | -------------------------------------------------- |
| `builders → conditions` | 18                                                 |
| `builders → helpers`    | 10                                                 |
| `builders → predicates` | 13                                                 |
| `conditions → helpers`  | 14                                                 |
| `helpers → builders`    | 2 ← **the closing edge** (`src/helpers/within.ts`) |
| `predicates → helpers`  | 3                                                  |

`helpers → predicates` and `predicates → builders` **do not exist** — both are the reverse of a real
edge. Two of the four arrows in our own flagship cycle finding are fabricated, and the edge that
actually closes the cycle is not in the message at all.

## Two defects, one root

**1. The message asserts arrows it cannot substantiate.** `canonicalizeCycle`'s own docstring reasons
that direction must not be normalized _"because `a -> b -> c -> a` and `a -> c -> b -> a` traverse
different edges and are genuinely different cycles"_ — a premise that requires the array to be an
edge-ordered path. It is not. So the code breaks a stated contract rather than a cosmetic convention.

**2. The finding cannot locate itself.** `findSliceDependencyDetails(slices, cycleNames[0],
cycleNames[1], …)` asks for details on the first two _members of a set_, which need not be an edge.
When it is not, `details` is empty and the violation reports `file: 'unknown', line: 0`. When it
happens to be an edge, the location is a **permitted** import — `call-rule-builder.ts:24` above is an
ordinary `builders → conditions` import, a legal direction.

`src/helpers/slice-graph.ts` predicts the `unknown:0` symptom and attributes it to mismatched
`options` between the graph and the details lookup. That is a real failure mode (plan 0085 guards it),
but it is **not** this one: this is upstream of options and fires with them perfectly aligned.

Plan 0085 added a row asserting "a re-export-only cycle is reported at a real file and line, not
`unknown:0`". It passes because it uses a **two**-slice cycle, where `members[0] → members[1]` is
necessarily an edge. It never covered the shape that breaks.

## Why it is worse now than it was

- Plan 0084 moved `arch/no-cycles` from `.warn()` to `.check()`, so this message is now the primary
  artifact a reader acts on rather than a line in passing output.
- Plan 0085 made re-exports edges. **A barrel is a hub**: every consumer joins one component, so
  multi-member SCCs went from unusual to the common case. The shape the changelog advertises as "the
  likeliest new finding" is the shape with the least trustworthy message.
- ADR-008 rule 2: an agent handed `src/builders/call-rule-builder.ts:24` and "extract shared code to a
  lower-level module" edits a legal import, achieves nothing, and improvises from there.

## Fix

Recover a **real** cycle rather than printing a set: a back-edge path from the DFS, or one shortest
cycle per SCC. Then locate the finding on an edge that exists — ideally the one that closes it.

Minimum viable, if the above is deferred: stop asserting arrows. `Cycle detected between: builders,
conditions, helpers, predicates` is honest about being a member list, and a sorted list also fixes
[bug 0056](./0056-a-cycle-identity-changes-when-imports-are-reordered.md).

**Do not** fix the location by widening the details lookup to "any pair in the component" — that
returns a legal import for most components and reintroduces defect 2 in a form that looks correct.

The message improvement is blocked on identity: today the message text _is_ part of the baseline hash,
so rewording it invalidates every cycle baseline. See
[plan 0088](../plans/0088-a-slice-finding-identifies-itself.md), which unblocks it and is the reason
this bug is filed separately from the plan.

## Test inventory

1. **A 3-ring and a 4-ring**, by identity: every arrow in the message must be a real edge. This is the
   row that reds today.
2. **The location is an edge that exists**, on a component of ≥ 3 members. Plan 0085's existing row
   only covers 2.
3. **The closing edge is named**, for the barrel shape specifically — that is the remedy the reader
   needs.
4. **A 2-slice cycle keeps working**, so the fix is not a rewrite that loses the easy case.
5. **VACUITY: the ground-truth edge set is derived independently** of the graph under test, or the
   comparison is the implementation agreeing with itself.

## Related

- [Bug 0056](./0056-a-cycle-identity-changes-when-imports-are-reordered.md) — same root, different
  symptom: the member order is a DFS artifact, so the identity is unstable.
- [Plan 0088](../plans/0088-a-slice-finding-identifies-itself.md) — unblocks the message rewrite.
- [Bug 0054](./0054-within-makes-helpers-depend-on-builders.md) — the real closing edge in our own
  component, which this message fails to name.
- `src/conditions/slice.ts` — `beFreeOfCycles`, `canonicalizeCycle`.
- `src/helpers/tarjan.ts` — returns membership, not paths.
