import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import type { ArchProject } from '../../src/core/project.js'
import { modules } from '../../src/builders/module-rule-builder.js'
import { slices } from '../../src/builders/slice-rule-builder.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/presets/layered')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('.describeRule() method', () => {
  const p = loadTestProject()

  it('returns rule description with metadata (RuleBuilder)', () => {
    const desc = modules(p)
      .that()
      .resideInFolder('**/services/**')
      .should()
      .notImportFrom('**/routes/**')
      .rule({
        id: 'layer/no-routes-in-services',
        because: 'services must not depend on routes',
        suggestion: 'move route logic to a controller',
        docs: 'https://example.com/adr/layers',
      })
      .describeRule()

    expect(desc.id).toBe('layer/no-routes-in-services')
    expect(desc.because).toBe('services must not depend on routes')
    expect(desc.suggestion).toBe('move route logic to a controller')
    expect(desc.docs).toBe('https://example.com/adr/layers')
    expect(desc.rule).toContain('should')
  })

  it('returns rule description without metadata (RuleBuilder)', () => {
    const desc = modules(p)
      .that()
      .resideInFolder('**/services/**')
      .should()
      .notImportFrom('**/routes/**')
      .describeRule()

    expect(desc.id).toBeUndefined()
    expect(desc.rule).toContain('should')
  })

  it('returns rule description with metadata (TerminalBuilder)', () => {
    const desc = slices(p)
      .assignedFrom({ routes: '**/routes/**', services: '**/services/**' })
      .should()
      .beFreeOfCycles()
      .rule({ id: 'layer/no-cycles', because: 'cycles break modularity' })
      .describeRule()

    expect(desc.id).toBe('layer/no-cycles')
    expect(desc.because).toBe('cycles break modularity')
  })

  it('does not execute the rule', () => {
    // This rule would throw if executed (reversed layers) — but describe doesn't execute
    const desc = slices(p)
      .assignedFrom({
        repositories: '**/repositories/**',
        services: '**/services/**',
        routes: '**/routes/**',
      })
      .should()
      .respectLayerOrder('repositories', 'services', 'routes')
      .rule({ id: 'test/would-fail' })
      .describeRule()

    expect(desc.id).toBe('test/would-fail')
    // No throw — describe does not evaluate
  })
})
