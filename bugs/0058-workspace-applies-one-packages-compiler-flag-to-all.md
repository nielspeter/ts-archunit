# Bug 0058: `workspace()` applies one package's `verbatimModuleSyntax` to every package

**Reported:** 2026-08-04 · **Fixed:** not yet
**Found in:** v0.49.0
([plan 0087](../plans/completed/0087-an-inline-type-import-still-requests-the-module.md)), the release
that started reading the flag.
**Severity:** **High.** Wrong in **both** directions on a published condition, silently, in the
configuration where slice rules are most used — a monorepo. Which direction you get is decided by an
alphabetical path sort.

## What

```ts
function usesVerbatimModuleSyntax(sourceFile: SourceFile): boolean {
  return sourceFile.getProject().getCompilerOptions().verbatimModuleSyntax === true
}
```

Correct for `project()`. Wrong for `workspace()`, which builds **one** ts-morph `Project` from the
alphabetically-first tsconfig and then only _adds files_ from the rest — `addSourceFilesFromTsConfig`
adds files, not options. So every file is judged by the tie-break winner's flag.

Measured with this repo's own fixture pair:

```
project(ON)   alone              -> ['[a, b]']   correct
project(OFF)  alone              -> []           correct

workspace([ON, OFF])   primary = ...-off  (flag false)
  the flag:TRUE package          -> []           FALSE NEGATIVE, the real cycle vanished
```

And forcing the opposite sort order with renamed fixtures:

```
workspace([ON, OFF])   primary = ...-on   (flag true)
  the flag:FALSE package         -> ['[a, b]']   FALSE POSITIVE, a phantom cycle
```

The false positive is the worse half: it **reds CI on a cycle that cannot exist at runtime**, and the
shipped remedy ("extract shared code to a lower-level module") cannot remediate it because there is
nothing to extract. An agent handed that finding restructures working code.

`docs/upgrading.md` says _"It now reads the flag from your tsconfig"_ — singular. For a workspace
consumer that sentence is false.

## Scope, precisely

Only the `'module-request'` question is affected, so only `beFreeOfCycles`. `isErased` takes no
`verbatim` argument, so `typeOnly` — and therefore `notDependOn`, `respectLayerOrder`, `dependOn`,
`notImportFrom`, `onlyImportFrom` — is unaffected.

**This is not a cache bug.** The cached value is correct _for the project it was computed in_; the
project is the wrong thing to ask. A fix that adds invalidation will not help. (The related mutation
hypothesis — options changed after edges are cached — was measured and **refuted**:
`Project.compilerOptions.set()` triggers a reparse which fires `onModified`, so the entry is dropped.
That invalidation is accidentally correct and worth a comment before someone "fixes" it away.)

## Fix

Resolve the flag **per file**, from the tsconfig that owns it. The machinery exists: `workspace()`
already has `resolvedPaths`, and `src/core/project-relative.ts` already keeps a per-`Project` root list
with `rootOf(sourceFile)` answering "which root owns this file" — the same shape can carry per-root
compiler options. This is bug 0035's shape, in the file that already fixed it for globs, whose own
comment says _"EVERY config, not just the primary"_.

Minimum viable alternative: make `workspace()` **fail** when its configs disagree on
`verbatimModuleSyntax`, rather than silently picking one. Fail-closed beats a wrong answer nobody is
told about.

Either way, **the guard must be a workspace fixture with the flag genuinely mixed.** The existing pair
is only ever loaded through `project()`, which is why nothing in 3051 tests disagreed. The reviewer's
line is worth keeping: this defect is two fixture lines away from having been caught.

## Test inventory

1. **A mixed workspace, both directions**: the flag:true package reports its cycle, the flag:false
   package does not — in one `workspace()` load. Reds today, in one direction or the other depending on
   sort order.
2. **Both sort orders**, explicitly. A fix that reads the _last_ config instead of the first passes row 1
   half the time.
3. **A uniform workspace still works**, so per-file resolution has not broken the common case.
4. **`typeOnly` is unchanged** for every file in a mixed workspace — the four coupling conditions must
   not move.
5. **VACUITY: the workspace really loaded both packages' files**, asserted by path, or rows 1–3 pass over
   a project that silently contains one package.

## Related

- [Plan 0087](../plans/completed/0087-an-inline-type-import-still-requests-the-module.md) — added the read.
- [Bug 0035](./fixed/0035-a-workspace-has-no-single-root.md) — same shape, same file, already solved for
  globs.
- `src/core/module-edges.ts`, `src/core/project.ts`, `src/core/project-relative.ts`.
