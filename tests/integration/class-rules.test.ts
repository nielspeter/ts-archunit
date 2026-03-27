import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { classes } from '../../src/builders/class-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('classes() member property conditions integration (plan 0030)', () => {
  const p = loadTestProject()

  it('enforces no forbidden property on class', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^ClassWithForbiddenProp$/)
        .should()
        .shouldNotHavePropertyNamed('offset')
        .check()
    }).toThrow(ArchRuleError)
  })

  it('enforces readonly on classes (no double-should)', () => {
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^(ReadonlyClass|MutableClass)$/)
        .should()
        .haveOnlyReadonlyProperties()
        .check()
    }).toThrow(ArchRuleError) // MutableClass has mutable props
  })

  it('enforces property count on classes', () => {
    // ClassWithForbiddenProp has 2 props (offset, filter) — passes max 10
    // ReadonlyClass has 2 props — passes max 10
    // MutableClass has 2 props — passes max 10
    expect(() => {
      classes(p)
        .that()
        .haveNameMatching(/^(ReadonlyClass|MutableClass|ClassWithForbiddenProp)$/)
        .should()
        .maxProperties(10)
        .check()
    }).not.toThrow()
  })
})
