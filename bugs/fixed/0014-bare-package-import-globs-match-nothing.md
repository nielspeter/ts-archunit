# Bug 0014: `notImportFrom('fastify')` matches nothing when fastify is installed

**Reported:** 2026-07-25
**Fixed:** 2026-07-26
**Found in:** all versions through v0.19.0
**Severity:** High — the documented way to ban a dependency silently enforces nothing for any package that resolves, which is the normal case. Dependency rules are among the first rules a team writes.

## Description

`resolveImportPath` (`src/conditions/dependency.ts:13`) returns **either** the
resolved path **or** the raw specifier:

```ts
function resolveImportPath(decl: ImportDeclaration): string {
  const resolved = decl.getModuleSpecifierSourceFile()
  return resolved ? resolved.getFilePath() : decl.getModuleSpecifierValue()
}
```

An installed package with types resolves, so the glob is compared against
`/…/node_modules/@types/picomatch/index.d.ts` — and a bare name like
`'picomatch'` never matches it. The bare form only works when the import
**fails** to resolve.

That is backwards: the rule works on packages you have not installed, and
silently passes on the ones you have.

## Reproduction

Two files, one importing an installed package, one importing a missing one:

```
notImportFrom('ts-morph')              ->  0 violations   package IS installed
notImportFrom('some-uninstalled-pkg')  ->  1 violation    not installed
notImportFrom('**/ts-morph/**')        ->  1 violation    path form works
```

Also measured against this repo's own source, which imports `picomatch` in four
files: `notImportFromCondition('picomatch')` over `**/src/**` reports **0**.

## The docs recommend the broken form

- `CHANGELOG.md` (0.18.1, Upgrading): _"a bare package name like `importFrom('fastify')` is fine, because unresolvable imports fall back to the raw specifier"_
- `docs/slices.md:32-33`: _"falling back to the raw specifier only when the import does not resolve — so a bare package name works as written"_
- `tests/archunit/arch-rules.test.ts:562`: _"so users can write `.notImportFrom('fastify', 'knex', 'bullmq')`"_

Both doc statements are literally true about the mechanism and wrong about the
outcome: they describe the fallback correctly, then conclude the bare name
"works", when resolution is exactly what stops it working.

## Why no test caught it

There is **no test anywhere** for a bare package specifier — `grep` over
`tests/` for `importFrom('<bare-name>')` returns nothing. The dependency tests
use path globs. Any fixture that did use a bare name would likely import a
package that is not installed in the fixture, which is the one case that
passes.

Apply ADR-008's question: _what would the dependency suite do if bare
specifiers matched nothing?_ Pass, entirely.

## Suggested fix

Match against **both** derivations, not one:

```ts
function importCandidates(decl: ImportDeclaration): string[] {
  const specifier = decl.getModuleSpecifierValue()
  const resolved = decl.getModuleSpecifierSourceFile()
  return resolved ? [resolved.getFilePath(), specifier] : [specifier]
}
```

A glob matches the import if it matches **either**. That makes
`notImportFrom('fastify')` work whether or not fastify ships types, and leaves
every existing path-glob rule unchanged — the resolved path is still tested.

Prefer this over failing loudly on a bare name. The principle
[plan 0069](../../plans/0069-no-rule-may-certify-nothing.md) settles on: **first
make the natural spelling work, then fail loudly when it still cannot match.**
0067-C reached the same conclusion for path normalization: make the
project-relative glob spelling resolve, rather than only reporting it loudly.

### Watch for over-matching

`[resolved, specifier]` widens what a glob can hit. A relative specifier
(`'../services/foo.js'`) would now be tested as a string as well as a path, so
a glob like `**/services/**` could match the specifier of an import that
resolves somewhere else entirely. Restrict the specifier candidate to
**non-relative** specifiers (not starting with `.` or `/`), which is exactly the
bare-package case this fixes.

## Guard this needs

- A bare specifier for an **installed, resolvable** package fires. The fixture
  must import something genuinely present in `node_modules` — a fixture that
  imports a missing package tests the passing case and proves nothing.
- A bare specifier for an unresolvable package still fires (no regression).
- A path glob still matches the resolved path (no regression).
- A relative specifier is **not** matched as a raw string (the over-match above).

## Relationship to plan 0069

0069 guards globs that match nothing. This is the adjacent class where the glob
form is _documented as correct_ and cannot match by construction — no guard
would help, because the user wrote the sanctioned thing. It has to be fixed at
the matcher. Filed separately so it can ship without waiting on 0069's breaking
change.
