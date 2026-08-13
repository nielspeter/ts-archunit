import { describe, it, expect, afterEach } from 'vitest'
import {
  isGraphQLAvailable,
  loadSchemaFromSDL,
  setGraphQLLoaderForTests,
  resetGraphQLLoaderForTests,
} from '../../src/graphql/schema-loader.js'

/**
 * requireGraphQL()'s catch branch (src/graphql/schema-loader.ts) distinguishes
 * "graphql is not installed" from "graphql is installed but could not be
 * loaded". Every existing test runs in an environment where `graphql` loads
 * successfully, so neither branch is reachable through them — these tests
 * force each failure shape through `setGraphQLLoaderForTests()`.
 *
 * Previously this mocked `node:module`'s `createRequire` via
 * `vi.doMock()` + `vi.resetModules()` + a dynamic `import()` per test. That
 * intercepted a Node builtin, which Vitest does not reliably isolate
 * per-file under its default worker-reuse — passed 8/8 in isolation but
 * failed intermittently under full-suite load (bug 0080), including the
 * actual v0.60.0 publish workflow. The seam this file uses now replaces only
 * `schema-loader.ts`'s own loading step directly — no module graph, no
 * builtin, nothing shared with any other file to race on.
 */

describe('requireGraphQL() error branching', () => {
  afterEach(() => {
    resetGraphQLLoaderForTests()
  })

  it('resetGraphQLLoaderForTests() restores the real loader', () => {
    // Each test below sets its own loader before using it, so none of them
    // would notice a missing afterEach — this is the one direct proof that
    // reset actually restores real, working graphql loading rather than
    // leaving a prior test's stub (or a stale cache) in place.
    setGraphQLLoaderForTests(() => {
      throw new Error('stub — should never be reachable after reset')
    })
    resetGraphQLLoaderForTests()

    expect(isGraphQLAvailable()).toBe(true)
  })

  it('reports "not installed" when graphql itself cannot be found', () => {
    setGraphQLLoaderForTests(() => {
      throw Object.assign(new Error("Cannot find module 'graphql'"), {
        code: 'MODULE_NOT_FOUND',
      })
    })

    expect(isGraphQLAvailable()).toBe(false)

    try {
      loadSchemaFromSDL('type Query { hello: String }')
      expect.fail('expected loadSchemaFromSDL to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      if (!(err instanceof Error)) throw err
      expect(err.message).toMatch(/required but not installed/)
      expect(err.cause).toBeDefined()
    }
  })

  it('reports the underlying cause for a corrupt install (MODULE_NOT_FOUND naming an internal file, not graphql itself)', () => {
    // Verified against real Node behaviour: requiring an installed package
    // whose own internal require() fails throws MODULE_NOT_FOUND naming THAT
    // file ("Cannot find module './language/kinds.js'"), never the top-level
    // package name. Same code as the "not installed" case; different
    // specifier. Routing this to "not installed" was the bug the fix in
    // commit 511ae24 aimed at but did not fully close — this pins the case.
    setGraphQLLoaderForTests(() => {
      throw Object.assign(new Error("Cannot find module './language/kinds.js'"), {
        code: 'MODULE_NOT_FOUND',
      })
    })

    expect(isGraphQLAvailable()).toBe(false)

    try {
      loadSchemaFromSDL('type Query { hello: String }')
      expect.fail('expected loadSchemaFromSDL to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      if (!(err instanceof Error)) throw err
      expect(err.message).toMatch(/installed but could not be loaded/)
      expect(err.message).toContain("Cannot find module './language/kinds.js'")
      expect(err.cause).toBeDefined()
    }
  })

  it('reports the underlying cause when graphql throws during its own module init', () => {
    setGraphQLLoaderForTests(() => {
      throw new SyntaxError('Unexpected token in graphql/index.js')
    })

    expect(isGraphQLAvailable()).toBe(false)

    try {
      loadSchemaFromSDL('type Query { hello: String }')
      expect.fail('expected loadSchemaFromSDL to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      if (!(err instanceof Error)) throw err
      expect(err.message).toMatch(/installed but could not be loaded/)
      expect(err.message).toContain('Unexpected token in graphql/index.js')
      expect(err.cause).toBeDefined()
    }
  })
})
