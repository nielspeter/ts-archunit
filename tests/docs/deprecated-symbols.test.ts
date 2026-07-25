import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readDeprecatedSymbols } from './deprecated-symbols.js'
import * as publicApi from '../../src/index.js'

const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))

function loadRepoProject(): Project {
  return new Project({ tsConfigFilePath: path.join(repoRoot, 'tsconfig.json') })
}

describe('readDeprecatedSymbols', () => {
  const project = loadRepoProject()

  it('finds the deprecated symbols and resolves every name', () => {
    const symbols = readDeprecatedSymbols(project)
    // Non-vacuity: `toEqual([])`-style assertions below are meaningless on an
    // empty set, and at 1.0 (tags deleted) this fails loudly instead of going
    // quietly green — which is the signal to retire this whole scan.
    expect(
      symbols.length,
      'no @deprecated symbols found in src/ — either the tags are gone (retire this ' +
        'scan; see plan 0063) or symbol collection broke. It must not silently pass.',
    ).toBeGreaterThan(0)
    expect(symbols.every((s) => s.name.length > 0)).toBe(true)
    expect(symbols.every((s) => s.declaredAt.includes(':'))).toBe(true)
  })

  /**
   * ADR-008 rule 5: `collides` drives the entire false-positive story, so it is
   * checked against a value derived a DIFFERENT way — ts-morph static analysis vs.
   * the runtime ES module namespace object. Two mechanisms that cannot fail the
   * same way. A same-derivation test here would report pass while the flag was
   * globally broken.
   */
  it('collides agrees with the runtime export surface', () => {
    for (const symbol of readDeprecatedSymbols(project)) {
      expect(
        symbol.collides,
        `collides for '${symbol.name}' disagrees with the real export surface. Do NOT ` +
          'flip this flag or edit this test — collides MUST come from ' +
          'getExportedDeclarations(). If it goes all-false, legitimate reference-table ' +
          'rows in docs/api-reference.md start failing the docs scan.',
      ).toBe(symbol.name in publicApi)
    }
  })

  /**
   * ADR-008 rule 2: the violation's FIX line is the tag's own prose, so assert the
   * prose exists. `/** @deprecated *\/` with no text is legal TypeScript and would
   * leave a finding whose remedy is an empty string.
   */
  it('every @deprecated tag carries a usable remedy', () => {
    const symbols = readDeprecatedSymbols(project)
    expect(symbols.length, 'no deprecated symbols found — this guard is vacuous').toBeGreaterThan(0)
    for (const symbol of symbols) {
      expect(
        symbol.replacement,
        `@deprecated on '${symbol.name}' (${symbol.declaredAt}) has no usable ` +
          'replacement. FIX: write the replacement into the tag itself, e.g. ' +
          '"Use `extend()` after `.should()` instead." Do NOT delete this test — the ' +
          'tag text IS the fix an agent is handed when the docs scan fires.',
      ).toMatch(/`\w+\(\)`/)
    }
  })
})
