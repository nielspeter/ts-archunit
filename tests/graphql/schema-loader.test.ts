import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
  loadSchemaFromGlob,
  loadSchemaFromSDL,
  isGraphQLAvailable,
} from '../../src/graphql/schema-loader.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/graphql')

describe('schema-loader', () => {
  describe('isGraphQLAvailable()', () => {
    it('returns true when graphql package is installed', () => {
      expect(isGraphQLAvailable()).toBe(true)
    })
  })

  describe('loadSchemaFromSDL()', () => {
    it('parses a valid SDL string', () => {
      const loaded = loadSchemaFromSDL(`
        type Query {
          hello: String
        }
      `)
      expect(loaded.schema).toBeDefined()
      expect(loaded.schema.getQueryType()).toBeDefined()
      expect(loaded.documents).toHaveLength(1)
      expect(loaded.documents[0]?.filePath).toBe('<inline>')
    })

    it('throws on invalid SDL', () => {
      expect(() => loadSchemaFromSDL('not valid graphql {')).toThrow()
    })

    it('parses schema with minimal type', () => {
      const loaded = loadSchemaFromSDL(`
        type Query {
          _empty: Boolean
        }
      `)
      expect(loaded.schema).toBeDefined()
    })

    it('preserves source path when provided', () => {
      const loaded = loadSchemaFromSDL('type Query { hello: String }', '/path/to/schema.graphql')
      expect(loaded.documents[0]?.filePath).toBe('/path/to/schema.graphql')
    })
  })

  describe('loadSchemaFromGlob()', () => {
    it('loads and merges multiple .graphql files', () => {
      const loaded = loadSchemaFromGlob(fixturesDir, 'schema/{types,queries,mutations}.graphql')
      expect(loaded.documents).toHaveLength(3)

      // Verify Query type was loaded
      const queryType = loaded.schema.getQueryType()
      expect(queryType).toBeDefined()
      const queryFields = queryType!.getFields()
      expect(queryFields['users']).toBeDefined()
      expect(queryFields['user']).toBeDefined()

      // Verify Mutation type was loaded
      const mutationType = loaded.schema.getMutationType()
      expect(mutationType).toBeDefined()
      const mutationFields = mutationType!.getFields()
      expect(mutationFields['createUser']).toBeDefined()

      // Verify custom types were loaded
      const typeMap = loaded.schema.getTypeMap()
      expect(typeMap['User']).toBeDefined()
      expect(typeMap['Post']).toBeDefined()
      expect(typeMap['UserCollection']).toBeDefined()
    })

    it('throws when no files match the glob', () => {
      expect(() => loadSchemaFromGlob(fixturesDir, 'nonexistent/**/*.graphql')).toThrow(
        'No .graphql files found',
      )
    })

    it('loads a single file', () => {
      const loaded = loadSchemaFromGlob(fixturesDir, 'schema/standalone.graphql')
      expect(loaded.documents).toHaveLength(1)
      const typeMap = loaded.schema.getTypeMap()
      expect(typeMap['StandaloneQuery']).toBeDefined()
    })
  })
})
