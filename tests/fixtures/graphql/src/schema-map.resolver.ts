// An idiomatic GraphQL resolver map: resolvers are object-literal properties,
// not named declarations. This is the shape every GraphQL server uses, and the
// shape the other fixtures in this folder do NOT have — which is why
// `resolvers()` could be blind to it without a single test failing.

interface Ctx {
  loader: { load: (id: string) => Promise<unknown> }
  db: { query: (sql: string) => Promise<unknown> }
}

interface Parent {
  authorId: string
  id: string
}

export const schemaResolvers = {
  Query: {
    // Good: goes through the DataLoader.
    user: async (_parent: unknown, args: { id: string }, ctx: Ctx): Promise<unknown> => {
      return ctx.loader.load(args.id)
    },
    // Bad: hits the database directly from a resolver.
    posts: async (_parent: unknown, _args: unknown, ctx: Ctx): Promise<unknown> => {
      return ctx.db.query('SELECT * FROM posts')
    },
  },
  Post: {
    // Good.
    author: async (parent: Parent, _args: unknown, ctx: Ctx): Promise<unknown> => {
      return ctx.loader.load(parent.authorId)
    },
    // Bad: method shorthand, also hitting the database directly.
    async comments(parent: Parent, _args: unknown, ctx: Ctx): Promise<unknown> {
      return ctx.db.query(`SELECT * FROM comments WHERE post = '${parent.id}'`)
    },
  },
}
