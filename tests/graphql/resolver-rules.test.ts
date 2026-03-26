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

  it('resolveFieldReturning() with no match produces no violations', () => {
    expect(() => {
      resolvers(p, 'src/**/*.resolver.ts')
        .that()
        .resolveFieldReturning(/ZZZNonExistentType/)
        .should()
        .contain(call('loader.load'))
        .check()
    }).not.toThrow()
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
