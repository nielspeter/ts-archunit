# Bug 0035: a workspace has no single root, and a relative glob picked one alphabetically

**Reported:** 2026-08-01
**Fixed:** 2026-08-01, unreleased
**Found in:** v0.35.0 (path predicates) and v0.36.1 (`assignedFrom`) — by asking what `workspace()` does, _after_ releasing both
**Severity:** High. Silent, green, and name-dependent: half a workspace went unchecked with no diagnostic.

## Description

`workspace([a, b])` sets `ArchProject.tsConfigPath` to the **alphabetically first** config, and `src/core/project.ts` is explicit that this is a _tie-breaker_ chosen "so the primary config (first) is deterministic regardless of call order". Plan 0067 part C and bug 0033 promoted that tie-breaker into author-facing semantics: "the project root" became that one package.

Measured on a two-package workspace (`packages/alpha`, `packages/beta`, each with `src/api/a.ts`):

```
tsConfigPath                    <ws>/packages/alpha/tsconfig.json
assignedFrom  'src/api/**'      1 file   (alpha only)
resideInFolder 'src/api/**'     1 subject (alpha only)
both anchored '**/src/api/**'   2
rule.violations()               []       <- green
diagnose([rule])                []       <- doctor says nothing
```

Adding a package named `aaa` would re-point every relative glob in the suite. That is [bug 0011](./0011-dogfood-rules-select-nothing.md)'s failure class — a rule scoped by a name nobody chose deliberately — and slightly worse, because there the dependency was the checkout directory's name and here it is the _sort position of a sibling package_.

## Fix

**Every root is kept, and each file resolves against the root that contains it.** `project()` and `workspace()` register their directories on the ts-morph `Project`; `rootOf` picks the containing root, longest first so a nested package's tsconfig wins over the repository's.

The registry is keyed on the ts-morph project rather than the `ArchProject` because a **predicate sees only an element** — `sourceFile.getProject()` is the one handle both a predicate and the slice resolver can reach, and ts-morph itself records only the primary config.

Rejected: refusing a relative glob under `workspace()`. The only remedy it could state is "anchor it with `**/`", and that is _lossy_ — the anchored form also matches vendored and nested copies, which is what root-relative resolution exists to avoid. A remedy that downgrades the rule is not a remedy (ADR-008 rule 2).

### Two more defects the same review surfaced, both fixed here

**`''` meant two things.** `rootFromTsConfigPath('/tsconfig.json')` returned `''`, which one derivation read as "the root is `/`" and another as "no root known". Measured on a tsconfig at the filesystem root — reachable in a container that mounts the repo at `/` — the rule discovered its file while `diagnose()` called the same glob dead, in one run. It now returns `'/'`, and containment goes through a single `prefixOf`.

**`isProjectRelative` and `isAnchored` disagreed.** `isAnchored` recognises a drive-absolute `C:/x/**`; `isProjectRelative` did not, so a Windows path was declared project-relative. Now defined as its negation. `*/x/**` stays excluded deliberately — normalizing it would make it match, which sounds like an improvement until you notice it is the **last reachable `unanchored` fault** for a path glob, and the whole anchor-advice path would become unreachable code.

## The fix introduced a dependency cycle, and this repo's own rule caught it

`import { isAnchored }` into `project-relative.ts`, plus `project.ts` importing the new registrar, closed:

```
disk-set -> path-universe -> glob-diagnosis -> project-relative -> project -> disk-set
```

Found by `slices(self).matching('src/core/*').should().beFreeOfCycles()` — the project's own dogfooding, in `tests/core/diagnose.test.ts`, failing on a test that had nothing to do with the change. `isAnchored` is pure string syntax with no dependencies, so it moved down to `project-relative.ts` and `glob-diagnosis.ts` re-exports it; the edge inverts and the cycle is gone.

## Guard

`tests/core/workspace-has-no-single-root.test.ts`. It asserts the fixture _is_ a workspace and that `tsConfigPath` really is only one of its configs — without both, the test would pass for a reason unrelated to the fix — then that every package's folder is matched, that the predicates agree, and that a single-tsconfig project is unchanged.

Separately, `tests/core/relative-globs-are-uniform.test.ts` gained the discriminator it was missing: the fixture had exactly **one** `src/domain`, so "relative" and "anywhere" selected the same set and an implementation using the looser rewrite would have passed every row. A nested second copy separates them, 3 against 4.

## Related

- [Bug 0033](./0033-assignedFrom-does-not-accept-a-project-relative-glob.md) — extended the flaw to a third surface.
- [Bug 0036](../0036-the-relative-glob-audit-is-incomplete.md) — three more surfaces are unaudited, and the uniformity guard's surface list is hand-maintained.
