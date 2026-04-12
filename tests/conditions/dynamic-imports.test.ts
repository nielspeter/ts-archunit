import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { beImported } from '../../src/conditions/reverse-dependency.js'
import type { ConditionContext } from '../../src/core/condition.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/dynamic-imports')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })

function getSourceFile(relativePath: string) {
  const fullPath = path.join(fixturesDir, relativePath)
  const sf = tsMorphProject.getSourceFile(fullPath)
  if (!sf) throw new Error(`Fixture not found: ${fullPath}`)
  return sf
}

const ctx: ConditionContext = { rule: 'test rule' }

describe('pre-check: findReferencesAsNodes and dynamic imports', () => {
  it('findReferencesAsNodes resolves dynamic import references', () => {
    // Check if the language service sees the dynamic import of lazyHelper
    const target = getSourceFile('src/target.ts')
    const lazyHelperDecl = target.getExportedDeclarations().get('lazyHelper')
    expect(lazyHelperDecl).toBeDefined()

    const languageService = tsMorphProject.getLanguageService()
    const refs = languageService.findReferencesAsNodes(lazyHelperDecl![0]!)
    const externalRefs = refs.filter(
      (ref) => ref.getSourceFile().getFilePath() !== target.getFilePath(),
    )

    // findReferencesAsNodes resolves the destructured dynamic import in consumer.ts,
    // so haveNoUnusedExports() already works for dynamic imports without changes.
    expect(externalRefs.length).toBeGreaterThan(0)
  })
})

describe('dynamic import detection (Phase 1: beImported)', () => {
  it('detects modules imported only via dynamic import()', () => {
    const target = getSourceFile('src/target.ts')
    const violations = beImported().evaluate([target], ctx)
    // After implementation: target.ts should have 0 violations
    // (consumer.ts dynamically imports it)
    expect(violations).toHaveLength(0)
  })

  it('still detects genuinely dead modules', () => {
    const orphan = getSourceFile('src/orphan.ts')
    const violations = beImported().evaluate([orphan], ctx)
    expect(violations).toHaveLength(1)
  })

  it('resolves template literal specifiers (no substitutions)', () => {
    // template-only-target.ts is ONLY imported via template literal in template-consumer.ts
    // This isolates the NoSubstitutionTemplateLiteral handling
    const templateOnly = getSourceFile('src/template-only-target.ts')
    const violations = beImported().evaluate([templateOnly], ctx)
    expect(violations).toHaveLength(0)
  })

  it('still detects statically imported modules', () => {
    const staticOnly = getSourceFile('src/static-only.ts')
    const violations = beImported().evaluate([staticOnly], ctx)
    expect(violations).toHaveLength(0)
  })
})
