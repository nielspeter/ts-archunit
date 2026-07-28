import { defineConfig } from 'vitest/config'

// Deliberately DEFAULT everything else: the property under test is what the
// default reporter shows for a PASSING test in a non-TTY run.
export default defineConfig({
  test: {
    include: ['*.test.mts'],
  },
})
