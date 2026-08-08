import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { resolvers } from '../../src/graphql/index.js'
import { ResolverRuleBuilder } from '../../src/graphql/resolver-rule-builder.js'
import { call } from '../../src/helpers/matchers.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/graphql')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('resolvers() entry point', () => {
  const p = loadTestProject()

  it('returns a ResolverRuleBuilder', () => {
    expect(resolvers(p, 'src/**/*.resolver.ts')).toBeInstanceOf(ResolverRuleBuilder)
  })
})

describe('ResolverRuleBuilder — predicates', () => {
  const p = loadTestProject()

  it('resolveFieldReturning() matches functions by return type', () => {
    // resolvePostAuthor returns Promise<User> — should match /User/
    // This should find some functions and then check body analysis
    expect(() => {
      resolvers(p, 'src/**/*.resolver.ts')
        .that()
        .resolveFieldReturning(/User/)
        .should()
        .contain(call('loader.load'))
        .check()
    }).toThrow(ArchRuleError)
    // post.resolver.ts resolvePostAuthor returns User but doesn't use loader.load
  })

  it('resolveFieldReturning() with string matches return type substring', () => {
    expect(() => {
      resolvers(p, 'src/**/*.resolver.ts')
        .that()
        .resolveFieldReturning('User')
        .should()
        .contain(call('loader.load'))
        .check()
    }).toThrow(ArchRuleError)
  })

  it('resolveFieldReturning() with no match now FAILS at the floor — plan 0099', () => {
    // Behaviour flip. This asserted `.not.toThrow()`: a predicate matching nothing
    // passed vacuously. The throw ALONE would not be enough — it would also pass
    // if `contain()` started producing a bogus violation over an empty set, which
    // is what this row was originally about — so assert it is the configuration
    // finding and names the fault.
    const rule = resolvers(p, 'src/**/*.resolver.ts')
      .that()
      .resolveFieldReturning(/ZZZNonExistentType/)
      .should()
      .contain(call('loader.load'))
    expect(() => rule.check()).toThrow()
    const vs = rule.violations()
    expect(vs.filter((v) => v.bypassFilters === true)).toHaveLength(1)
    expect(vs[0]?.message).toContain('examined 0')
    // Not an ordinary violation dressed up as one.
    expect(vs.filter((v) => v.bypassFilters !== true)).toEqual([])
  })

  it('resolveFieldReturning() only filters; unmatched functions are excluded', () => {
    // Functions returning void or other types should not be included
    expect(() => {
      resolvers(p, 'src/**/*.resolver.ts')
        .that()
        .resolveFieldReturning(/QueryResult/)
        .should()
        .contain(call('loader.load'))
        .check()
    }).toThrow(ArchRuleError)
    // query.resolver.ts allUsers/allPosts return QueryResult but don't call loader.load
  })
})

describe('ResolverRuleBuilder — conditions (body analysis reuse)', () => {
  const p = loadTestProject()

  it('contain(call()) finds matching body expressions', () => {
    // user.resolver.ts functions call loader.load — should pass
    expect(() => {
      resolvers(p, 'src/user.resolver.ts').should().contain(call('loader.load')).check()
    }).not.toThrow()
  })

  it('notContain(call()) reports violations', () => {
    // post.resolver.ts findUserById should not call loader.load
    expect(() => {
      resolvers(p, 'src/post.resolver.ts').should().notContain(call('findUserById')).check()
    }).toThrow(ArchRuleError)
  })

  it('.because() includes reason in error', () => {
    try {
      resolvers(p, 'src/**/*.resolver.ts')
        .that()
        .resolveFieldReturning(/User/)
        .should()
        .contain(call('loader.load'))
        .because('prevent N+1 queries')
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.message).toContain('prevent N+1 queries')
    }
  })

  it('.warn() does not throw even with violations', () => {
    expect(() => {
      resolvers(p, 'src/**/*.resolver.ts')
        .that()
        .resolveFieldReturning(/User/)
        .should()
        .contain(call('loader.load'))
        .warn()
    }).not.toThrow()
  })
})

/**
 * Bug 0013 — `resolvers()` must see resolvers.
 *
 * A GraphQL resolver map is an object literal, so resolvers are property values,
 * not named declarations. `functions()` keeps object-literal collection opt-in
 * (turning it on there would flood every rule with inline callbacks); the
 * GraphQL entry point has the opposite need and must always opt in.
 *
 * Ask ADR-008's question of the tests above: what would they do if `resolvers()`
 * could not see a single resolver in a resolver map? They would pass — every
 * other fixture in this folder uses named declarations only. Hence this block
 * and the `schema-map.resolver.ts` fixture.
 */
describe('ResolverRuleBuilder — resolver maps (bug 0013)', () => {
  const p = loadTestProject()

  it('selects resolvers declared as object-literal properties', () => {
    // `contain()` reports every subject that lacks the call, so the violation
    // set names the selected subjects.
    const selected = resolvers(p, 'src/schema-map.resolver.ts')
      .should()
      .contain(call('__never_present__'))
      .violations()
      .map((v) => v.element)

    expect(selected).toContain('schemaResolvers.Query.user')
    expect(selected).toContain('schemaResolvers.Query.posts')
    expect(selected).toContain('schemaResolvers.Post.author')
    // Method shorthand too, not just arrow property values.
    expect(selected).toContain('schemaResolvers.Post.comments')
  })

  it('enforces a rule per resolver, not per enclosing file', () => {
    const offenders = resolvers(p, 'src/schema-map.resolver.ts')
      .should()
      .notContain(call('ctx.db.query'))
      .violations()
      .map((v) => v.element)

    // Exactly the two that hit the database — the two that use the loader are
    // not swept up. A whole-file scan could not draw this line, which is the
    // false-green this bug describes.
    expect(offenders.sort()).toEqual([
      'schemaResolvers.Post.comments',
      'schemaResolvers.Query.posts',
    ])
  })
})

describe('ResolverRuleBuilder — a held selection is immutable (bug 0016)', () => {
  const p = loadTestProject()

  // Same hierarchy, same defect as SchemaRuleBuilder: this builder extends
  // TerminalBuilder directly, so `RuleBuilder`'s copy-on-write did not reach
  // it. Both assertions below are on rules that MUST fail.

  it('a second rule off a held resolver set is not narrowed by the first', () => {
    const all = resolvers(p, 'src/**/*.resolver.ts')

    // Rule 1 narrows to User-returning resolvers, which do use the loader.
    expect(() =>
      all.that().resolveFieldReturning(/User/).should().contain(call('loader.load')).check(),
    ).toThrow(ArchRuleError)

    // Rule 2 must still see the whole set. Under the bug it saw
    // /User/ ∩ /QueryResult/ = ∅ and passed.
    expect(() =>
      all
        .that()
        .resolveFieldReturning(/QueryResult/)
        .should()
        .contain(call('loader.load'))
        .check(),
    ).toThrow(ArchRuleError)
  })

  it('a second condition off a held resolver set does not stack with the first', () => {
    const all = resolvers(p, 'src/**/*.resolver.ts')
    const first = all.should().contain(call('loader.load')).violations()
    const second = all.should().contain(call('loader.load')).violations()

    // Identical rules report identically. A leaked condition would double the
    // second count; a leaked predicate would empty it.
    expect(first.length).toBeGreaterThan(0)
    expect(second).toHaveLength(first.length)
  })
})
