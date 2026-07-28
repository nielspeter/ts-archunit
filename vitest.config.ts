import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
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
