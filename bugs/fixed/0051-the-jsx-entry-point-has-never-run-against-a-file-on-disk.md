# Bug 0051: the JSX entry point has never run against a file on disk

**Reported:** 2026-08-04 · **Fixed:** 2026-08-04 (v0.47.0)
**Found in:** every version since `jsxElements()` shipped, by two independent reviewers of
[plan 0083](../../plans/0083-eat-our-own-dogfood.md) — a product review and a customer review reached it
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

## Fix as shipped

`tests/fixtures/jsx-on-disk/` — a real `tsconfig.json`, two `.tsx` files on disk in
`components/` and `pages/`, and `tests/integration/jsx-on-disk.test.ts` reaching them through
`project(tsconfigPath)`. Seven rows, asserted by identity (`relpath:tag`).

**The three operational constraints landed first**, and the plan to prove them before writing any
test was the right order — the first `npm run validate` with the fixture present and no test at all
failed with six errors:

```
TS17004: Cannot use JSX unless the '--jsx' flag is provided
TS2694: Namespace 'JSX' has no exported member 'Element'
TS6142: Module '../components/Button.js' was resolved to '…Button.tsx', but '--jsx' is not set
```

- **Root `tsconfig.json` excludes the fixture.** It includes `tests` and sets no `jsx`, so the root
  program cannot compile `.tsx`. The fixture carries its own tsconfig instead.
- **ESLint needed nothing** — it already ignores `tests/fixtures/**`. Predicted as a required change
  and measured as already handled.
- **`format:check` gained a `*.tsx` pathspec.** It enumerates extensions while `npm run format`
  rewrites everything, so without this the fixture would drift with no signal.

**`"jsx": "preserve"`, not `"react-jsx"`.** The latter demands `react/jsx-runtime` types; measured,
the fixture's own program fails `tsc` with TS2875 without them, and pulling in `@types/react` would
parse the whole React type graph on every program load for no benefit. Under `preserve` the fixture
type-checks standalone (`tsc -p … --noEmit` → 0).

### What the sabotage taught, including the row that caught nothing

| Revert                                   | Result                |
| ---------------------------------------- | --------------------- |
| Discovery filters out `.tsx` files       | CAUGHT                |
| Remove `jsx` from the fixture's tsconfig | **CAUGHT BY NOTHING** |

The second is the interesting one. **Discovery does not need `jsx` set** — ts-morph parses `.tsx`
syntax regardless; the setting governs type-checking. Good news for an adopter with a half-configured
tsconfig, and a hazard for a fixture: it could drift into not being a JSX project while still
"proving" JSX works. Now asserted directly (`compilerOptions.jsx === 'preserve'`) rather than assumed
from the file extension.

### What it did NOT find

No library defect. `jsxElements()` discovers `.tsx` files on disk correctly, `areComponents()`
narrows correctly, and the accessibility rule `docs/jsx.md` teaches (`img` must have `alt`) fires on
a real file. **The bug was the absence of the test, not a fault behind it** — which is the honest
outcome and worth stating plainly, because "we found no defect" is the result a coverage gap most
often has, and it is not an argument that the gap did not matter. Two things came out of writing it:
the `jsx`-independence above, and the confirmation that a selector for an absent tag produces a
**configuration finding** rather than a silent pass, which is the library's own thesis holding on its
own fixture.

## Related

- [Plan 0083](../../plans/0083-eat-our-own-dogfood.md) — where this was found, and which now cites this
  bug instead of carrying JSX as a sub-item of a triage.
- `docs/jsx.md` — the 257 lines this bug is about.
- [Bug 0049](./0049-the-type-assertion-self-check-selected-classes.md) — the same shape one
  layer up: a check that existed, passed, and had never run against the thing it claimed to cover.
