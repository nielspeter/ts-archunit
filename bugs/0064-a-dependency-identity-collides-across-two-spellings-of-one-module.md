# Bug 0064: a dependency identity collides across two spellings of one module

**Reported:** 2026-08-05 · **Fixed:** not yet
**Found in:** pre-existing, long before v0.56.0. Surfaced by the five-persona review of the bug-0059
branch, and **not** caused by it.
**Severity:** High. A baseline fail-open on a published surface — one accepted entry silently
pre-accepts a second, genuinely different dependency edge. Blast radius is the baseline identity string
adopters store on disk, which is the top row of [ADR-008](../adr/008-agent-first-failure-surfaces.md)
rule 6.

## What happens

`edgeViolation`'s identity is built from the **resolved absolute path** of the target
(`edgeCandidates(edge, sourceFile)[0]`, `src/conditions/dependency.ts`), while every discriminator inside
it derives from the **specifier as written**. Two spellings that resolve to the same file therefore
produce one identity for two distinct findings.

Measured on an in-memory project with `paths: { '@app/*': ['src/*'] }`, one file importing the same
module by an alias and by a relative path:

```
DYNAMIC, two spellings
  notImportFrom: findings=2  hashes=1   *** COLLISION ***
  identities = ["…::dynamic::/src/legacy/index.ts::#0",
                "…::dynamic::/src/legacy/index.ts::#0"]

NAMED import, two spellings
  notImportFrom: findings=2  hashes=1   *** COLLISION ***
  identities = ["…::import::/src/legacy/index.ts::old",
                "…::import::/src/legacy/index.ts::old"]
```

This is [bug 0028](./fixed/0028-two-findings-in-one-file-can-share-a-baseline-identity.md)'s shape, and
the layout that triggers it — a `paths` alias beside relative imports — is the common monorepo one.

## Three things the fix must not get wrong

Each of these was got wrong once during review, so they are recorded rather than left to be
rediscovered.

**1. It is not a v0.56.0 regression, and the ordinal is not the cause.** The named-import block above
reproduces under the _pre-ordinal_ discriminator, where no ordinal is consulted at all. Filing it against
that release, or bisecting to it, sends the reader to the wrong commit. v0.56.0 neither caused nor
worsened it.

**2. Keying the ordinal counter on the resolved path does not fix it.** That was the first proposed
remedy. It cannot work: when `names` is non-empty the discriminator returns the names and never reaches
the ordinal branch, so the named case above stays collided.

**3. It is module-family only.** The slice family's `siteIdentity` (`src/conditions/slice.ts`) keys on the
raw `edge.specifier`, so the same fixtures give **2 findings / 2 hashes** through `notDependOn`. The
slice family is accidentally correct here. A future "make the two families consistent" change could
therefore _propagate_ this defect rather than fix it — the direction of consistency matters.

## Not measured

`onlyImportFrom` and `dependOn`. Both read the same constant and `onlyImportFrom` routes through the same
`edgeViolation`, so the collision is **expected** there — expected, not measured. Measure before writing
the fix, so the guard covers the real set.

## Candidate fix

Generalise the trick that closed the names-less collision in v0.56.0, rather than adding a component to
the identity (which would move every dependency entry an adopter holds, for a defect most of them do not
have).

Key the ordinal counter on `kind::resolvedPath ?? specifier` — the same key the identity uses — and have
`edgeDiscriminator` append `#n` for `n > 0` **whether or not `names` is present**:

| group member                      | today | proposed |
| --------------------------------- | ----- | -------- |
| first, named                      | `old` | `old`    |
| second, named, different spelling | `old` | `old#1`  |
| first, names-less                 | `''`  | `''`     |
| second, names-less                | `#1`  | `#1`     |

The first member of every group keeps a byte-identical identity, so the migration is empty — the same
property v0.56.0 established and measured. Only the colliding sibling moves, and those groups are exactly
the ones whose baseline entry was already wrong.

**Verify before adopting**, since the analogous claim was wrong once already: replay the identity strings
against the previous release across every spelling, and replay real baselines through `filterNew`, rather
than reasoning from the table above.

## Guard

`tests/conditions/identity-does-not-move.test.ts` is the file this belongs in — it already enumerates
spellings against captured pre-release values. It needs a two-spelling fixture, which requires `paths` in
the in-memory project's compiler options. Note the existing rows would not have caught this: every fixture
there reaches its target by exactly one spelling.
