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

  it('typesNamed() matching nothing now FAILS at the floor — plan 0099', () => {
    // Behaviour flip, same shape as the resolver row: the throw alone would also
    // pass if `haveFields` began emitting over an empty set, so assert identity.
    const rule = schemaFromSDL(fullSDL)
      .typesNamed(/Nonexistent$/)
      .should()
      .haveFields('whatever')
    expect(() => rule.check()).toThrow()
    const vs = rule.violations()
    expect(vs.filter((v) => v.bypassFilters === true)).toHaveLength(1)
    expect(vs[0]?.message).toContain('examined 0')
    expect(vs.filter((v) => v.bypassFilters !== true)).toEqual([])
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

describe('SchemaRuleBuilder — a held selection is immutable (bug 0016)', () => {
  // docs/graphql.md teaches holding a `schemaFromSDL()` result and deriving
  // several rules from it. This hierarchy forked in NEITHER `that()` nor
  // `should()`, so rule 2 inherited rule 1's predicate: two name patterns that
  // cannot both match, an empty selection, and a pass however broken the schema.
  //
  // Every assertion below is on a rule that MUST fail. A guard whose rules
  // pass is satisfied by the bug it guards against.

  it('a second rule off a held schema is not narrowed by the first', () => {
    const s = schemaFromSDL(fullSDL)

    // Rule 1 narrows to User and passes — User has every field named.
    expect(() =>
      s
        .that()
        .typesNamed(/^User$/)
        .should()
        .haveFields('id', 'name')
        .check(),
    ).not.toThrow()

    // Rule 2 asks about a DIFFERENT type, and must fail: BadCollection has
    // only `items`. Under the bug its selection was User ∩ BadCollection = ∅.
    expect(() =>
      s
        .that()
        .typesNamed(/^BadCollection$/)
        .should()
        .haveFields('total')
        .check(),
    ).toThrow(ArchRuleError)
  })

  it('a second rule off a held schema does not inherit the first condition', () => {
    const s = schemaFromSDL(fullSDL)
    const collections = s.that().typesNamed(/Collection$/)

    // Only BadCollection lacks `total`, so exactly one violation — not two,
    // which is what a leaked second copy of the same condition would report.
    expect(
      collections
        .should()
        .haveFields('total')
        .violations()
        .map((v) => v.element),
    ).toEqual(['BadCollection'])
    expect(
      collections
        .should()
        .haveFields('total')
        .violations()
        .map((v) => v.element),
    ).toEqual(['BadCollection'])
  })

  it('narrowing a held schema leaves the original selection whole', () => {
    const s = schemaFromSDL(fullSDL)
    const collections = s.that().typesNamed(/Collection$/)
    const bad = collections.that().typesNamed(/^Bad/)

    expect(
      bad
        .should()
        .haveFields('total')
        .violations()
        .map((v) => v.element),
    ).toEqual(['BadCollection'])
    // The original still covers all three Collection types; the two good ones
    // satisfy it, so the count is unchanged rather than zero.
    expect(
      collections
        .should()
        .haveFields('total')
        .violations()
        .map((v) => v.element),
    ).toEqual(['BadCollection'])
    // All three Collection types, by name — "the count is unchanged rather
    // than zero" was the comment, and the names are what it meant.
    expect(
      collections
        .should()
        .haveFields('nothing')
        .violations()
        .map((v) => v.element)
        .sort(),
    ).toEqual(['BadCollection', 'PostCollection', 'UserCollection'])
  })
})
