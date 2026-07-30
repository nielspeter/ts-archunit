/**
 * The `@example` blocks in `src/core/combinators.ts` must compile.
 *
 * Plan 0069 line 153 recorded that all three did not: they showed
 * `functions(p).that(not(areAsync()))`, and `that()` takes no argument
 * (`rule-builder.ts:61`). Three real doc bugs inside `src/`, and no markdown
 * scanner can ever see them because they are in TypeScript comments.
 *
 * This is the guard, and it is deliberately a compiled test rather than a string
 * check: the only thing that establishes an example compiles is compiling it.
 * Transcribed by hand from the docstrings, so a future edit that breaks them again
 * fails here — the transcription is the weak link and the alternative (parsing
 * docstrings at runtime) cannot typecheck what it extracts.
 */
import { describe, it, expect } from 'vitest'
import { functions, project } from '../../src/index.js'
import { not, and, or } from '../../src/core/combinators.js'
import { areAsync } from '../../src/predicates/function.js'
import { areExported } from '../../src/predicates/identity.js'

describe('src/core/combinators.ts @example blocks', () => {
  const p = project('tsconfig.json')

  // `tsc` is the real guard — these three lines existing and typechecking IS the
  // property. The assertions only stop the constructions being dead-code-eliminated
  // and confirm each yields a usable rule; asserting on `describeRule()` text would
  // pin wording this test has no business owning.
  it('not() — the form the docstring shows', () => {
    expect(functions(p).that().satisfy(not(areAsync())).should().beExported()).toBeDefined()
  })

  it('and() — the form the docstring shows', () => {
    expect(
      functions(p).that().satisfy(and(areAsync(), areExported())).should().beExported(),
    ).toBeDefined()
  })

  it('or() — the form the docstring shows', () => {
    expect(
      functions(p).that().satisfy(or(areAsync(), areExported())).should().beExported(),
    ).toBeDefined()
  })
})
