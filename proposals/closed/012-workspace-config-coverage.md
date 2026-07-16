# Proposal 012 — Workspace Config-Coverage Rules

**Status:** Closed — rejected as core; the root fix is a package-manager flag
**Closed:** 2026-07-17 (architect + product review)
**Reason:** The diagnosis is real and the evidence is the best-argued in the repo — but
every evidence bullet has one root cause: the root script hand-enumerates workspaces
instead of using `npm run lint --workspaces --if-present`, which fixes them permanently
and by construction. The proposal's own suggestion text (`'Prefer eslint with
--workspaces'`) concedes this. On pnpm (`pnpm -r`), Turborepo (`turbo run`), and Nx
(`nx run-many`) the disease is **structurally absent**. So the population served is
npm/yarn users who hand-enumerate and won't stop — one workflow, and the workflow is the
bug. Deferred to a companion package pending demand from a **second, independent**
monorepo. One genuine win extracted — see "Review verdict" below.

**Priority:** ~~Medium~~ Deferred
**Affects:** ~~new `workspaces()` builder~~ — nothing; superseded by a reasoned-exclusions proposal
**Origin:** a production monorepo — a recurring class of "a new workspace escaped a
hand-maintained config list" bugs. Reference implementation already running
there: `scripts/check-workspace-coverage.ts` (zero-dep tsx). This proposes
promoting it to a first-class ts-archunit capability.

## Problem

In a monorepo, the workspace **glob** (`apps/*`, `packages/*`, …) is the source
of truth for what exists. But several config surfaces re-list workspace members
**by hand** — the root `lint` script's dir list, individual CI test/lint/typecheck
steps — instead of deriving from the glob. So every new workspace must be added to
N places, and a miss is **silent**: the workspace is simply never linted / tested /
typechecked, and nothing fails.

ts-archunit exists to catch exactly this class for _code_ structure ("a check that
cannot fail reports the same as one that passes"). The same disease lives one level
up, in the **build/CI config**, and today there is no first-class way to assert it.

### Evidence (all real, all found one-at-a-time)

- `apps/identity-gateway` was never linted — surfaced real errors once wired in.
- `tests/architecture` was never lint/typechecked.
- The IG integration suite (~1027 tests) ran nowhere in CI.
- ~10 package/app **test** suites ran nowhere; hid 4 red tests behind green merges.
- `identity-gateway-ui`, `cli`, `migrations`, `preview` have `lint` scripts but the
  enumerated root `lint` command omits them.

Each was patched in isolation. A guard would have caught all of them, automatically,
on the next missed workspace.

## Why ts-archunit

- It **already models the workspace set** — `workspace(tsConfigPaths)` (Proposal 001)
  loads every workspace's project. The manifest is right there.
- Its **no-silent-exclusions** ethos (Proposal 006) is exactly the right stance for
  the escape hatch: a workspace may be excluded from coverage, but only _explicitly,
  with a reason_ — never dropped silently.
- The alternative is every monorepo hand-rolling a `check-workspace-coverage.ts`
  (as that project did). That script is ~120 lines of `readdirSync` + string-matching CI
  YAML — brittle, and re-invented per repo.

### Scope note (honest)

This capability reasons about **`package.json` scripts and CI config (YAML)** — not
the TypeScript AST that `modules()`/`classes()`/`functions()` inspect. It is adjacent
to, not inside, ts-archunit's current core. Two framings:

1. A new top-level `workspaces()` builder that reads the workspace manifest and
   asserts coverage against _external config text_ (root scripts, a CI file).
2. A separate companion package (`@nielspeter/monorepo-archunit`) sharing the fluent
   API and the silent-exclusion machinery.

I lean (1): it reuses `workspace()`, the rule/`because`/`check()` reporting, and the
silent-exclusion model, and the invariant ("every member of the glob is covered")
is squarely structural. But the AST-vs-config boundary is a real design decision for
the maintainer.

## Proposed API

```ts
import { workspaces } from '@nielspeter/ts-archunit'

// TEST coverage: every workspace with a `test` script must be run by a CI step.
workspaces('.') // reads root package.json `workspaces`
  .that()
  .haveScript('test')
  .should()
  .beRunIn('.github/workflows/ci.yml') // matches `npm test --workspace=<name>`
  .exceptDeferred({
    // explicit, reasoned — cf. Proposal 006
    '@acme/dev-mock': 'dev-only mock',
    '@acme/e2e': 'needs a running server (integration job)',
  })
  .rule({
    id: 'monorepo/test-coverage',
    because:
      'A workspace with a test script that no CI step runs is a check that cannot ' +
      'fail — it reports the same as one that passes.',
    suggestion: 'Add an npm test --workspace step to ci.yml, or exceptDeferred() it with a reason',
  })
  .check()

// LINT coverage: every workspace with a `lint` script must be covered by the root
// lint script — either it uses --workspaces, or the workspace dir is listed.
workspaces('.')
  .that()
  .haveScript('lint')
  .should()
  .beCoveredByScript('lint') // reads root package.json scripts.lint
  .rule({
    id: 'monorepo/lint-coverage',
    because: '…',
    suggestion: 'Prefer `eslint` with --workspaces',
  })
  .check()
```

Condition helpers to add:

- `haveScript(name)` — filter workspaces whose `package.json` declares a script.
- `beRunIn(ciPath, opts?)` — a workspace is covered if the CI file contains a
  **test invocation** (`npm test`/`vitest`) naming it via `--workspace=<name>` or a
  `working-directory: <dir>` step. `opts.pattern` overrides the matcher.
- `beCoveredByScript(scriptName)` — covered if the named root script uses
  `--workspaces` (or `-ws`), or names the workspace's dir (trailing-slash match, so
  `apps/foo` does not satisfy `apps/foo-bar`).
- `.exceptDeferred(record)` — a `SilentExclusion`-style map of `name → reason`;
  deferrals are printed in the report (never silent), and an unused deferral warns
  (a workspace removed but still listed), mirroring the stale-exclusion warning.

## Reference implementation

That project's `scripts/check-workspace-coverage.ts` implements the two checks above as a
standalone tsx script (bug 0302). It works but is the per-repo re-invention this
proposal removes. Once shipped, it would replace the script with:

```ts
// tests/architecture/monorepo-coverage.test.ts
workspaces('.').that().haveScript('test').should().beRunIn('.github/workflows/ci.yml')
  .exceptDeferred({ … }).rule({ … }).check()
```

## Open questions

1. **CI-file matching** is inherently heuristic (grep over YAML). Worth a light
   YAML parse (steps → `run`/`working-directory`) instead of line regex? The
   reference script uses line regex and it is already fiddly.
2. **Beyond lint/test** — the same drift hit _typecheck_ there (CI ran
   `typecheck --workspaces`, missing the arch typecheck the root script adds).
   Should coverage also assert "the CI step calls the root script, not a narrower
   subset"? That may be a step too far into CI-shape assertions.
3. **Package-manager portability** — read `workspaces` from `package.json` (npm/yarn)
   and `pnpm-workspace.yaml` (pnpm). `workspace()` already resolves projects; can the
   glob be reused rather than re-read?

---

## Review verdict (2026-07-17)

Architect + product review. **Rejected as core.** Recorded here so the reasoning outlives
the proposal.

### Factual corrections to this document

- **"It already models the workspace set" (above) is false.** `workspace(tsConfigPaths)`
  (`src/core/project.ts:110`) takes an explicit `string[]` — **there is no glob**, and the
  returned `ArchProject` keeps only `tsConfigPath` (singular), discarding the others. So
  open question 3's premise is void: the glob cannot be reused because it never existed.
- **The "Scope note" was already answered — a release ago.** `tsconfig(project)`
  (`src/tsconfig/index.ts:19`) already asserts on `tsconfig.json`, a non-TS config file.
  But the precedent licenses _"assert on config the tool already resolves"_, **not**
  _"assert on arbitrary config text"_ — so it covers `beCoveredByScript`, and not
  `beRunIn`.

### Why rejected

1. **Generic fitness fails.** See Reason above — the root fix is a flag, and the disease
   is structurally absent on pnpm/Turborepo/Nx.
2. **`beRunIn` is ADR-006's explicitly rejected alternative** — it bakes GitHub Actions
   knowledge (file path, YAML step shape, `working-directory`, `--workspace=` syntax) into
   core. GitLab/Circle/Buildkite users get nothing.
3. **`beRunIn` reproduces the disease it fights.** Regex-over-YAML fails two ways, both
   fatal: matching nothing → every workspace reports uncovered → users escape via
   `opts.pattern`, which is now a hand-maintained string that drifts (the very artifact
   this proposal exists to abolish); matching too eagerly (a comment, a disabled step) →
   **a check that cannot fail.** And `RuleBuilder.evaluate()` returns `[]` when no
   elements survive the predicates, so a typo'd `ciPath` → zero violations → green. A
   light YAML parse does not rescue it: parsing reveals step shape, not whether
   `turbo run test` transitively covers a workspace. That needs executing the CI graph.
4. **The counterfactual.** Had `workspaces()` shipped last release, would it have caught
   the deprecated-docs rot that proposal 013 addresses — this repo's own instance of
   _"a check that cannot fail"_? **No.** Nothing in this API touches that case. The cure
   does not cure the best example of the disease.
5. **The generic form is already expressible** in the runner we're built on:
   `expect(withTestScript.filter(w => !covered.includes(w))).toEqual([])`. When the
   generic form of a feature is five lines of vitest, it is not a primitive.

### What was extracted

`.exceptDeferred(record)` is ~90% re-invention: `.excluding()` already exists on **two**
base classes (`src/core/rule-builder.ts:144`, `src/core/terminal-builder.ts:62`) and
**already emits** the stale warning this proposal wanted to "mirror"
(`src/core/execute-rule.ts:59-66`). The real gap is one thing:

> **Exclusions carry no reason string.**

That is worth having, and it belongs on the base class where it serves `classes()`,
`modules()`, `functions()`, `tsconfig()`, and the smells — via a `deferred(pattern,
reason)` wrapper beside the existing `silent()` (`src/core/silent-exclusion.ts:34`).
**Split out as its own proposal.** Good instinct, wrong layer.

### If revived

Prerequisites: demand from a second, independent monorepo; `beRunIn` dropped or backed by
a real "cannot determine" state (never silently "not covered"); a name that does not
collide with `workspace()` (`monorepo('.')` was suggested); and shipped at a `./monorepo`
subpath with `yaml` as an optional peer dep — the `./graphql` precedent — not in core.

### Praise on record

The evidence section was called the best-argued in the repo. The "Scope note (honest)" —
surfacing the AST-vs-config boundary as an explicit maintainer decision and naming the
companion-package alternative it argued _against_ — is the behavior wanted in every
proposal; it wrote the counter-case fairly enough that the counter-case won. ADR-006 step 1
(prove the rule as a real script in a real repo first) was followed correctly. The answer
is simply that step 2's condition — _general enough to extract_ — was not met.
