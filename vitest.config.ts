import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Remove probe directories left by a KILLED run, before the file glob happens.
 *
 * `tests/core/warn-survives-the-test-runner.test.ts` writes deliberately-failing
 * probe files under `tests/__generated__/run-<pid>/` and deletes them in
 * `afterAll`. A killed run never reaches `afterAll`, and then:
 *
 *  - the leftovers are **gitignored**, so `git status` reads clean;
 *  - `include: ['tests/**\/*.test.ts']` collects them;
 *  - they are designed to fail.
 *
 * So the next run reds for a reason nothing in the working tree shows. A reviewer
 * hit exactly that — an isolated worktree whose first baseline read exit 1 — and
 * that is the ADR-008 rule 5 verdict-mechanism hazard at its sharpest: a sabotage
 * matrix reads exit codes and cannot tell that failure from a real one.
 *
 * **Here rather than in the test's `beforeAll`**, which is where it was tried
 * first: vitest globs its file list at startup, so a prune inside a test cleans
 * the NEXT run and not the one already collecting. Config load is before the glob.
 *
 * By pid LIVENESS, never by wildcard or age: `process.kill(pid, 0)` throws for a
 * dead pid and does nothing to a live one, so a concurrent sibling run's files are
 * never touched — deleting those is
 * [bug 0045](./bugs/fixed/0045-two-tests-fail-by-environment-and-corrupt-sabotage-verdicts.md).
 */
function pruneDeadProbeRuns(): void {
  const root = path.join(import.meta.dirname, 'tests/__generated__')
  if (!fs.existsSync(root)) return
  for (const entry of fs.readdirSync(root)) {
    const pid = Number(/^run-(\d+)$/.exec(entry)?.[1])
    if (!Number.isInteger(pid) || pid === process.pid) continue
    try {
      process.kill(pid, 0)
    } catch {
      fs.rmSync(path.join(root, entry), { recursive: true, force: true })
    }
  }
}

pruneDeadProbeRuns()

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Plan 0095: the vacuity matrix imports from `dist`, and this suite runs BEFORE the build
    // in both workflows. A matrix row that skipped when `dist/` was absent would be a check
    // that cannot fail, so it lives behind `npm run test:matrix` and an explicit post-build CI
    // step — the pattern `scripts/verify-package.mjs` established for the same reason.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/matrix/**'],
    globals: false,
    // Pinned, not just inherited: several modules use a swappable module-level
    // reference for test-only overrides (schema-loader.ts's loadGraphQL,
    // stderr.ts's listenerAttached, diff-disclosure.ts's noticed — the
    // *ForTests convention). Correctness of that pattern depends on each test
    // FILE getting its own module instance; isolate: false reuses one across
    // files sharing a worker, which is exactly the isolation gap bug 0080
    // measured (there, for a Node builtin; here, it would be for these
    // modules' own state). Left explicit so a throughput-motivated change
    // doesn't flip this silently.
    isolate: true,
    // Vitest's default is 5000ms, and this suite loads real ts-morph projects.
    // A case costing 300ms alone costs 3-5s under full parallelism — the repo's
    // own tsconfig is 454 files — so the default put several tests at 95% of
    // budget, and the suite returned 0, 16, 0 failures across three runs of
    // identical source. All 16 were timeouts, not assertions.
    //
    // Flakiness here is a correctness problem, not a nuisance: this project
    // verifies its guards by sabotage — break the source, require the guard to
    // fail — and an intermittent timeout is indistinguishable from a guard that
    // caught the sabotage. It reports a pass that was never earned. ADR-008's
    // reading is worse: an agent resolves a flaky guard the cheapest way
    // available, which is to weaken the guard.
    //
    // 30s, against ~2min for the whole suite in CI. Headroom is free; a
    // per-test budget a correct test cannot meet is not.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
