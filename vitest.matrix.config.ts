import { defineConfig } from 'vitest/config'

/**
 * The vacuity matrix runs under its own config — plan 0095.
 *
 * It cannot ride the default one: that config excludes `tests/matrix/**` on purpose (the matrix
 * imports `dist`, and `npm run test` runs before the build in both workflows), and vitest's
 * `--exclude` flag **appends** to the configured excludes rather than replacing them. So
 * `vitest run tests/matrix --exclude …` collected nothing and exited 1 with "No test files
 * found" — a step that looks like it ran and did not.
 *
 * Read that failure carefully, because the near-miss is the point: the same shape with a runner
 * that treats "no tests" as success is a CI step which passes while measuring nothing. That is
 * the exact defect the matrix underneath this config exists to detect, one level up.
 */
export default defineConfig({
  test: {
    include: ['tests/matrix/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // A run that collected no files is a lie, not a pass.
    passWithNoTests: false,
  },
})
