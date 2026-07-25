import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { smells } from '../../src/smells/index.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'
import { call } from '../../src/helpers/matchers.js'

function loadProject(dir: string): ArchProject {
  const tsconfigPath = path.join(dir, 'tsconfig.json')
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('smells — full fluent chain', () => {
  describe('duplicateBodies()', () => {
    const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/smells/duplicate-bodies')
    const p = loadProject(fixturesDir)

    it('detects duplicate function bodies', () => {
      expect(() => {
        smells.duplicateBodies(p).withMinSimilarity(0.7).minLines(5).check()
      }).toThrow(ArchRuleError)
    })

    it('.warn() does not throw', () => {
      expect(() => {
        smells.duplicateBodies(p).withMinSimilarity(0.7).minLines(5).warn()
      }).not.toThrow()
    })

    it('high similarity threshold finds nothing', () => {
      expect(() => {
        smells.duplicateBodies(p).withMinSimilarity(1.0).minLines(5).check()
      }).not.toThrow()
    })

    it('.because() is accepted in the chain', () => {
      expect(() => {
        smells
          .duplicateBodies(p)
          .withMinSimilarity(0.7)
          .minLines(5)
          .because('copy-pasted parsers should be consolidated')
          .warn()
      }).not.toThrow()
    })
  })

  describe('inconsistentSiblings()', () => {
    const fixturesDir = path.resolve(
      import.meta.dirname,
      '../fixtures/smells/inconsistent-siblings',
    )
    const p = loadProject(fixturesDir)

    it('detects siblings that lack the majority pattern', () => {
      expect(() => {
        smells.inconsistentSiblings(p).forPattern(call('this.extractCount')).minLines(3).check()
      }).toThrow(ArchRuleError)
    })

    it('.warn() does not throw', () => {
      expect(() => {
        smells.inconsistentSiblings(p).forPattern(call('this.extractCount')).minLines(3).warn()
      }).not.toThrow()
    })
  })
})

/**
 * The detectors must see functions that are object-literal property values.
 *
 * `functions()` keeps object-literal collection opt-in, because widening a
 * user-declared selector silently changes every existing rule. A detector has
 * no such contract — it scans for a property of the code — and a duplicated
 * arrow under an object key is exactly the copy-paste rot it exists to find.
 *
 * Ask ADR-008's question of the rest of this file: what would it do if the
 * detectors were blind to the entire handler-map idiom? Every test would pass,
 * because every other fixture here uses declarations. Measured on a real
 * codebase, closing this found 41 duplicate pairs that were structurally
 * invisible.
 */
describe('smells see object-literal functions', () => {
  const fixturesDir = path.resolve(
    import.meta.dirname,
    '../fixtures/smells/object-literal-duplicates',
  )
  const p = loadProject(fixturesDir)

  it('duplicateBodies reports duplicated handler-map entries', () => {
    const violations = smells.duplicateBodies(p).withMinSimilarity(0.9).minLines(4).violations()

    // A pair names one endpoint in `element` and the other in `message`, so
    // look at both — asserting on `element` alone would miss the partner.
    const text = violations.map((v) => `${v.element} ${v.message}`).join(' ')
    expect(violations.length, 'the three identical handlers must pair up').toBeGreaterThan(0)
    expect(text, 'arrow property value').toContain('createUser')
    expect(text, 'arrow property value').toContain('createTeam')
    expect(text, 'method shorthand').toContain('createGroup')
  })

  it('inconsistentSiblings sees the pattern inside object-literal handlers', () => {
    // duplicateBodies and inconsistentSiblings had the SAME blindness, but the
    // fixture above can only exercise one of them: it is a single file, and
    // this detector groups by folder. Reverting the inconsistent-siblings fix
    // therefore left the whole suite green — a fix held in place by nothing.
    //
    // Three sibling handlers call the sanctioned helper from inside an
    // object-literal function; one does not. If the detector cannot see those
    // functions, no file matches, the majority threshold is never reached, and
    // it reports nothing at all.
    const siblingsDir = path.resolve(
      import.meta.dirname,
      '../fixtures/smells/object-literal-siblings',
    )
    const violations = smells
      .inconsistentSiblings(loadProject(siblingsDir))
      .forPattern(call('validateInput'))
      .minLines(3)
      .violations()

    expect(violations.map((v) => v.element)).toEqual(['legacy.ts'])
    // The majority really was detected — otherwise the single finding could
    // come from some other reading of the folder.
    expect(violations[0]?.message).toContain('3 of 4 files')
  })

  it('does not report the handler that is genuinely different', () => {
    const violations = smells.duplicateBodies(p).withMinSimilarity(0.9).minLines(4).violations()
    const text = violations.map((v) => `${v.element} ${v.message}`).join(' ')
    // Precision matters as much as reach: a detector that flags everything is
    // the same as one that flags nothing.
    expect(text).not.toContain('deleteUser')
  })
})
