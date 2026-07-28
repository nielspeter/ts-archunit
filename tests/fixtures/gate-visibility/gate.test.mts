import { it } from 'vitest'
import { schemaFromSDL } from '../../../src/graphql/index.js'

// A PASSING test whose rule asserts nothing. The assertion gate must be
// visible in this — the least favourable — configuration: vitest's default
// reporter drops intercepted console output from passing tests, which is why
// the gate writes to process.stderr directly.
it('a green test terminating an assertion-less rule', () => {
  schemaFromSDL('type Query { a: String }').that().queries().should().check()
})
