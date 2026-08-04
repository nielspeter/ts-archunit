# Bug 0051: the JSX entry point has never run against a file on disk

**Reported:** 2026-08-04 · **Fixed:** not yet
**Found in:** every version since `jsxElements()` shipped, by two independent reviewers of
[plan 0083](../plans/0083-eat-our-own-dogfood.md) — a product review and a customer review reached it
separately from different starting points.
**Severity:** **High.** Not a wrong answer — a whole configuration that has never executed, and it is
the configuration every adopter of this feature starts in.

## What

**There is not one `.tsx` or `.jsx` file anywhere in this repository.** Measured:
`find . \( -name '*.tsx' -o -name '*.jsx' \) -not -path './node_modules/*'` → **0**.

Every JSX test builds its sources in memory:

- `tests/conditions/jsx.test.ts:15` — `useInMemoryFileSystem: true`, then `createSourceFile('test.tsx', code)`
- `tests/predicates/jsx.test.ts:21` — same
- `tests/builders/jsx-rule-builder.test.ts:11` — same

No fixture `tsconfig.json` sets a `jsx` compiler option; the in-memory projects set
`jsx: ts.JsxEmit.React` themselves.

Meanwhile `docs/jsx.md:7` teaches:

> The `jsxElements()` entry point operates on JSX elements across all `.tsx` and `.jsx` source files.

and `:200`–`:203` teach `resideInFile('**/pages/**/*.tsx')` and `resideInFile('**/*.tsx')`.

**So the path an adopter takes — `project('tsconfig.json')`, real files on disk, file discovery
reaching `.tsx`, a `jsx` setting in a real tsconfig, path aliases, barrels — has never run.** 257
lines of documentation stand on it.

## Why the plan filed this as reassurance, which was the error

Plan 0083's first draft counted the unapplied primitives and observed that "only **8** are JSX- or
GraphQL-shaped", presented as a reason not to worry. That measures **API surface**, not **risk**. Those
8 back the entry point that, with `layeredArchitecture`, is one of the two features an adopter shopping
for this tool came for.

The contrast with GraphQL is what makes it stark. GraphQL is _fine_: `tests/fixtures/graphql/` has a
real `tsconfig.json`, four `.graphql` files and four resolver files on disk, and
`tests/graphql/schema-loader.test.ts` asserts the package resolves. Both were in the same "not our
architecture" class, and only one of them was actually covered.

## What to do

Not a plan phase — a fixture and a test. The smallest honest version:

1. One directory with a real `tsconfig.json` carrying a `jsx` setting, and at least one `.tsx` file
   with a component tree deep enough for `jsxElements()` to traverse.
2. `project(...)` over that tsconfig, then the rules `docs/jsx.md` teaches — asserted by identity.
3. The discovery half specifically: that a `.tsx` file on disk is **found**, which is the step every
   in-memory test skips.

Three operational constraints, measured by a devops review and non-negotiable because each turns the
build red in a step _before_ the tests run — the failure signature that looks like nothing in the
working tree:

- **`tsconfig.json` has `include: ["src", "tests"]`** and no `jsx`, so a `.tsx` file on disk fails
  `npm run typecheck` with `TS17004: Cannot use JSX unless the '--jsx' flag is provided` **and**
  `TS7026: no interface 'JSX.IntrinsicElements' exists`. Needs a `jsx` setting or a tsconfig
  `exclude`, plus a source for `JSX.IntrinsicElements` — a ~20-line local `declare global` beats
  adding `@types/react`, whose type graph would be parsed on every program load for no benefit.
- **ESLint lints `tests/`** with `recommendedTypeChecked` and ignores only `tests/fixtures/**`.
  Excluding from tsconfig without adding an eslint `ignores` entry produces "file not found in any
  project" — the exact trap the `tests/__generated__` comments record.
- **`format:check` has no `*.tsx` pathspec** while `npm run format` rewrites `.tsx`, so the file
  would drift with no signal.

Land those three in the same commit as the fixture, and prove it by running `npm run validate` with
the fixture present _before_ writing any rule file.

## Related

- [Plan 0083](../plans/0083-eat-our-own-dogfood.md) — where this was found, and which now cites this
  bug instead of carrying JSX as a sub-item of a triage.
- `docs/jsx.md` — the 257 lines this bug is about.
- [Bug 0049](./fixed/0049-the-type-assertion-self-check-selected-classes.md) — the same shape one
  layer up: a check that existed, passed, and had never run against the thing it claimed to cover.
