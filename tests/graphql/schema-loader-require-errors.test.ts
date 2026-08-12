import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type * as NodeModule from 'node:module'

/**
 * requireGraphQL()'s catch branch (src/graphql/schema-loader.ts) distinguishes
 * "graphql is not installed" from "graphql is installed but could not be
 * loaded". Every existing test runs in an environment where `graphql` loads
 * successfully, so neither branch is reachable through them — reverting the
 * distinction entirely leaves the full suite green. These tests intercept
 * `node:module`'s `createRequire` to force each failure shape.
 *
 * A fresh module instance per test (`vi.resetModules()` + dynamic import) is
 * required: `requireGraphQL()` caches its result in a module-level variable,
 * so a second call within one module instance would never re-enter the catch.
 */

describe('requireGraphQL() error branching', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock('node:module')
  })

  it('reports "not installed" when graphql itself cannot be found', async () => {
    vi.doMock('node:module', async (importOriginal) => {
      const original = await importOriginal<typeof NodeModule>()
      return {
        ...original,
        createRequire: () => (_id: string) => {
          throw Object.assign(new Error("Cannot find module 'graphql'"), {
            code: 'MODULE_NOT_FOUND',
          })
        },
      }
    })

    const { isGraphQLAvailable, loadSchemaFromSDL } =
      await import('../../src/graphql/schema-loader.js')
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

  it('reports the underlying cause for a corrupt install (MODULE_NOT_FOUND naming an internal file, not graphql itself)', async () => {
    // Verified against real Node behaviour: requiring an installed package
    // whose own internal require() fails throws MODULE_NOT_FOUND naming THAT
    // file ("Cannot find module './language/kinds.js'"), never the top-level
    // package name. Same code as the "not installed" case; different
    // specifier. Routing this to "not installed" was the bug the fix in
    // commit 511ae24 aimed at but did not fully close — this pins the case.
    vi.doMock('node:module', async (importOriginal) => {
      const original = await importOriginal<typeof NodeModule>()
      return {
        ...original,
        createRequire: () => (_id: string) => {
          throw Object.assign(new Error("Cannot find module './language/kinds.js'"), {
            code: 'MODULE_NOT_FOUND',
          })
        },
      }
    })

    const { isGraphQLAvailable, loadSchemaFromSDL } =
      await import('../../src/graphql/schema-loader.js')
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

  it('reports the underlying cause when graphql throws during its own module init', async () => {
    vi.doMock('node:module', async (importOriginal) => {
      const original = await importOriginal<typeof NodeModule>()
      return {
        ...original,
        createRequire: () => (_id: string) => {
          throw new SyntaxError('Unexpected token in graphql/index.js')
        },
      }
    })

    const { isGraphQLAvailable, loadSchemaFromSDL } =
      await import('../../src/graphql/schema-loader.js')
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
