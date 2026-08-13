# Bug 0080: a `node:module` mock does not isolate cleanly under full-suite concurrency

**Reported:** 2026-08-12 · **Fixed:** 2026-08-13, unreleased
**Found in:** the v0.60.0 release's publish workflow — `prepublishOnly` re-runs the full suite a
second time (after the workflow's own explicit `npm run test` step already passed), and that second
run failed on a test that has nothing to do with the release being shipped.
**Severity:** Medium. Not a false green — the opposite: an intermittently false RED that can block a
release with no connection to what actually changed, on a test suite otherwise fully deterministic. Rare
enough to slip through code review (it did — this exact suspicion was raised and provisionally dismissed
during plan 0103's review, see below) but frequent enough to have now blocked a real publish.

## What

`tests/graphql/schema-loader-require-errors.test.ts` uses `vi.doMock('node:module', ...)` +
`vi.resetModules()` + a dynamic `import()` per test to force each catch-branch of `requireGraphQL()`
(`src/graphql/schema-loader.ts`). Measured:

- **In isolation** (`npx vitest run tests/graphql/`): 8 of 8 runs green.
- **As part of the full suite** (`npx vitest run`): failed 1 of 3 local runs, and failed the actual
  CI publish run for v0.60.0 (`gh run 31631465499`, job `94231004876`).

The failure is always the same shape: `isGraphQLAvailable()` returns `true` where the test expects
`false` — i.e., `requireGraphQL()`'s mocked `createRequire` was not the one actually invoked, and the
real `graphql` package (a real devDependency of this repo, used elsewhere in the suite) loaded
successfully instead.

## Why this is plausible, not just "flaky CI"

This project's own vitest config sets no explicit `pool`/`isolate` options, so Vitest 4's defaults
apply — worker processes are reused across test **files** for throughput, with per-file isolation
handled by resetting the module graph between files. `node:module` is a Node **builtin**, not a
regular npm-resolved module; whether Vitest's module runner resets a builtin's mock as reliably as it
does an ordinary import, under load (246 files, many spawning their own in-memory ts-morph `Project`
instances concurrently), is the open question this bug files rather than answers.

**A near-miss was already on record.** Plan 0103's testing review (2026-08-12, same day) wrote: _"Possible
flake, unrelated to 0102:
`tests/graphql/schema-loader-require-errors.test.ts > 'reports the underlying cause when graphql throws
during its own module init'` failed in 1 of 4 full-suite runs on an otherwise-unrelated sabotage, and
passed in the other 3. Worth a look independently."_ It was not looked at independently before v0.60.0's
release attempt, which is exactly the class of finding ADR-008 rule 5 exists to stop from being deferred
past the point it costs something.

## Consequence

`package.json`'s `prepublishOnly` script (`npm run validate && npm run build && node
scripts/verify-package.mjs`) re-runs the **entire** test suite a second time, immediately before `npm
publish`, on top of the workflow's own already-green `npm run test` step earlier in the same job. Two
full-suite runs per publish attempt roughly doubles the exposure to this flake per release, for a
mechanism (`prepublishOnly` defense-in-depth) that adds no coverage the workflow's own steps didn't
already provide.

## Fix sketch (not yet chosen)

1. **Root-cause the isolation gap directly** — reproduce under `vitest run --reporter=verbose` with
   `--no-file-parallelism` toggled on/off to confirm concurrency is the actual variable (measured only
   indirectly here: full suite vs. one directory, not full suite serial vs. parallel). If confirmed,
   either scope the mock more narrowly (mock the specific export path rather than the whole `node:module`
   built-in) or find the Vitest option that guarantees builtin-module mock isolation across a reused
   worker.
2. **Reduce exposure independently of the root cause**: `prepublishOnly` running the full suite a second
   time, with no different configuration than the workflow's own explicit test step, buys defense against
   a workflow that skips `npm run test` — not a real threat in this repo's own `publish.yml`, which
   always runs it first. Narrowing `prepublishOnly` to `verify-package.mjs` + build (skip the redundant
   second full test run) halves the exposure without touching the actual isolation bug.

Neither is chosen here — this bug is filed to record the measurement and the near-miss, not to prescribe
the fix under release-day time pressure per ADR-008 rule 6's own reasoning for an internal-check-over-a-
controlled-corpus row (rule 6: prove it, then stop — a full concurrency-boundary investigation is a
separate piece of work from filing that it's needed).

## What this is not

Not a defect in `requireGraphQL()`'s own logic — bug 0056/0076/0102/0103/0104's release
(`v0.60.0`) shipped no change to `src/graphql/schema-loader.ts`, and the same test passes deterministically
in isolation. This is a test-infrastructure gap, filed against the harness, not the family it exercises.

## Fix as shipped

**A third option, found during implementation: stop mocking the builtin at all.** Neither sketch above
was taken. `schema-loader.ts`'s loading step is now indirected through a swappable module-private
reference (`loadGraphQL`, defaulting to `defaultLoadGraphQL`), with two test-only exports —
`setGraphQLLoaderForTests()` / `resetGraphQLLoaderForTests()` — following the same `ForTests` convention
already used by `resetStderrGuardForTests()` (`src/core/stderr.ts`) and `resetDiffDisclosureForTests()`
(`src/core/diff-disclosure.ts`). Neither function is reachable from the published `./graphql` subpath:
`package.json`'s `exports` map has no wildcard under `graphql/`, and `src/graphql/index.ts` re-exports
only `loadSchemaFromGlob`/`loadSchemaFromSDL` by name — zero published-API surface added.

The test file (`tests/graphql/schema-loader-require-errors.test.ts`) now imports `schema-loader.ts`
**once**, statically, and calls `setGraphQLLoaderForTests()` per test instead of `vi.doMock('node:module',
...)` + `vi.resetModules()` + a dynamic re-import. This removes the isolation gap by construction rather
than by characterising it: no builtin is mocked, no module graph is reset, and every test body is fully
synchronous (no `await` between the swap and the assertions) — JS's single-threaded execution means
nothing else in the same worker can observe the swapped state mid-test, regardless of how Vitest schedules
files sharing that worker. `resetGraphQLLoaderForTests()` in `afterEach` restores the real loader and
clears `requireGraphQL()`'s cache, matching what `vi.resetModules()` used to buy per-test.

**Root cause (sketch 1) not chased further, by ADR-008 rule 6.** This is a test-infrastructure gap over a
corpus this project controls, not a published-API or irreversible-effect row — rule 6 asks for the
detector proved to fire and then stop, not a full characterisation of Vitest's builtin-mock isolation
under worker reuse. That characterisation remains genuinely open; this fix sidesteps it rather than
resolves it, and the note stays here in case another builtin gets mocked the same way in the future.

**Sketch 2 (narrowing `prepublishOnly`) not taken either** — it would have reduced exposure to the old
mechanism's flake rate, which is moot once the mechanism is gone. `prepublishOnly` is unchanged.

**Verified:** sabotaged the `notInstalled` regex in `requireGraphQL()`'s catch branch (reverted after) —
the corresponding test failed with the expected diff, confirming the rewritten tests still exercise the
real branching logic and are not vacuous. `npx vitest run tests/graphql/` passed 4/4 files in isolation;
the full suite (`npx vitest run`) passed 247/247 files across 8 consecutive runs, versus the original
~1-in-3 failure rate this bug measured.
