import { describe, it, expect } from 'vitest'
import { schemaFromSDL } from '../../src/graphql/index.js'
import { ArchRuleError } from '../../src/core/errors.js'

// Full schema SDL for testing (combines types, queries, mutations)
const fullSDL = `
type User {
  id: ID!
  name: String!
  email: String!
  posts: [Post!]!
}

type Post {
  id: ID!
  title: String!
  body: String!
  author: User!
}

type UserCollection {
  total: Int!
  skip: Int!
  limit: Int!
  items: [User!]!
}

type PostCollection {
  total: Int!
  skip: Int!
  limit: Int!
  items: [Post!]!
}

type BadCollection {
  items: [User!]!
}

type Query {
  users(skip: Int, limit: Int): [User!]!
  user(id: ID!): User
  posts(skip: Int, limit: Int): [Post!]!
  post(id: ID!): Post
}

type Mutation {
  createUser(name: String!, email: String!): User!
  updateUser(id: ID!, name: String, email: String): User
  deleteUser(id: ID!): Boolean!
  createPost(title: String!, body: String!, authorId: ID!): Post!
}
`

describe('SchemaRuleBuilder — predicates', () => {
  it('queries() filters to Query type fields', () => {
    // Query type has 4 fields, all should pass if we just check they exist
    expect(() => {
      schemaFromSDL(fullSDL).queries().should().acceptArgs('skip').check()
    }).toThrow(ArchRuleError)
    // user and post don't accept 'skip', users and posts do
  })

  it('mutations() filters to Mutation type fields', () => {
    expect(() => {
      schemaFromSDL(fullSDL).mutations().should().acceptArgs('name').check()
    }).toThrow(ArchRuleError)
    // Not all mutations accept 'name'
  })

  it('typesNamed() with exact string', () => {
    // UserCollection should have all pagination fields
    expect(() => {
      schemaFromSDL(fullSDL)
        .typesNamed('UserCollection')
        .should()
        .haveFields('total', 'skip', 'limit', 'items')
        .check()
    }).not.toThrow()
  })

  it('typesNamed() with regex matches multiple types', () => {
    // All *Collection types should have pagination fields — BadCollection will fail
    expect(() => {
      schemaFromSDL(fullSDL)
        .typesNamed(/Collection$/)
        .should()
        .haveFields('total', 'skip', 'limit', 'items')
        .check()
    }).toThrow(ArchRuleError)
  })

  it('typesNamed() with regex that matches nothing produces no violations', () => {
    expect(() => {
      schemaFromSDL(fullSDL)
        .typesNamed(/Nonexistent$/)
        .should()
        .haveFields('whatever')
        .check()
    }).not.toThrow()
  })

  it('returnListOf() filters to fields returning lists', () => {
    const sdl = `
      type Query {
        users: [User!]!
        user: User
        count: Int
      }
      type User { id: ID! }
    `
    // Only 'users' returns a list of 'User'
    expect(() => {
      schemaFromSDL(sdl).returnListOf('User').should().acceptArgs('limit').check()
    }).toThrow(ArchRuleError)
  })
})

describe('SchemaRuleBuilder — conditions', () => {
  it('haveFields() passes when all fields exist', () => {
    expect(() => {
      schemaFromSDL(fullSDL).typesNamed('User').should().haveFields('id', 'name', 'email').check()
    }).not.toThrow()
  })

  it('haveFields() fails when a field is missing', () => {
    expect(() => {
      schemaFromSDL(fullSDL)
        .typesNamed('User')
        .should()
        .haveFields('id', 'name', 'nonexistent')
        .check()
    }).toThrow(ArchRuleError)
  })

  it('acceptArgs() passes when all args exist', () => {
    expect(() => {
      schemaFromSDL(fullSDL)
        .queries()
        .that()
        .returnListOf('User')
        .should()
        .acceptArgs('skip', 'limit')
        .check()
    }).not.toThrow()
  })

  it('acceptArgs() fails when an arg is missing', () => {
    expect(() => {
      schemaFromSDL(fullSDL)
        .queries()
        .that()
        .returnListOf('User')
        .should()
        .acceptArgs('skip', 'limit', 'filter')
        .check()
    }).toThrow(ArchRuleError)
  })

  it('haveMatchingResolver() checks for resolver presence', () => {
    const resolverTexts = new Map<string, string>([
      ['user.resolver.ts', 'export function users() {} \nexport function user() {}'],
    ])

    // 'users' and 'user' have resolvers, but 'posts' and 'post' do not
    expect(() => {
      schemaFromSDL(fullSDL).queries().should().haveMatchingResolver(resolverTexts).check()
    }).toThrow(ArchRuleError)
  })

  it('haveMatchingResolver() passes when all fields have resolvers', () => {
    const resolverTexts = new Map<string, string>([
      [
        'resolvers.ts',
        'export function users() {} \nexport function user() {}\nexport function posts() {}\nexport function post() {}',
      ],
    ])

    expect(() => {
      schemaFromSDL(fullSDL).queries().should().haveMatchingResolver(resolverTexts).check()
    }).not.toThrow()
  })
})

describe('SchemaRuleBuilder — chain methods', () => {
  it('.because() includes reason in error', () => {
    try {
      schemaFromSDL(fullSDL)
        .typesNamed(/Collection$/)
        .should()
        .haveFields('total', 'skip', 'limit', 'items')
        .because('collections must have standard pagination fields')
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.message).toContain('collections must have standard pagination fields')
    }
  })

  it('.warn() does not throw', () => {
    expect(() => {
      schemaFromSDL(fullSDL)
        .typesNamed(/Collection$/)
        .should()
        .haveFields('total', 'skip', 'limit', 'items')
        .warn()
    }).not.toThrow()
  })

  it('.severity("error") throws on violations', () => {
    expect(() => {
      schemaFromSDL(fullSDL)
        .typesNamed(/Collection$/)
        .should()
        .haveFields('total', 'skip', 'limit', 'items')
        .severity('error')
    }).toThrow(ArchRuleError)
  })

  it('.severity("warn") does not throw', () => {
    expect(() => {
      schemaFromSDL(fullSDL)
        .typesNamed(/Collection$/)
        .should()
        .haveFields('total', 'skip', 'limit', 'items')
        .severity('warn')
    }).not.toThrow()
  })
})
