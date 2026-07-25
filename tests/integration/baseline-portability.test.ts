/**
 * Bug 0010 — violation identity must not encode where the code sits on disk.
 *
 * Every pre-existing `hashViolation` test builds the expected and the actual
 * value from the *same* literal, and the round-trip test generates and consumes
 * in one process from one cwd. Ask ADR-008's question of them — what would they
 * do if identity were fully machine-dependent? — and the answer is "pass".
 *
 * So the derivation here is deliberately a different one: the same source files
 * are materialised at two unrelated absolute paths, of **different depths**,
 * under **differently-named** roots, and the two runs must agree. A layout that
 * leaks into identity disagrees; a same-layout test cannot tell.
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Project } from 'ts-morph'
import { smells } from '../../src/smells/index.js'
import { functions } from '../../src/builders/function-rule-builder.js'
import { generateBaseline, withBaseline, hashViolation } from '../../src/helpers/baseline.js'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'

const sourceFixture = path.resolve(import.meta.dirname, '../fixtures/smells/duplicate-bodies')

const created: string[] = []

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Materialise the fixture at a fresh absolute path.
 *
 * `nesting` puts the checkout at a different depth in each layout, which is the
 * part a `path.relative()`-based fix would silently get wrong: relativising
 * encodes `../../..` chains whose length is a property of the machine.
 */
function materialize(prefix: string, nesting: string[]): { root: string; project: ArchProject } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(tmp)
  const root = path.join(tmp, ...nesting)
  fs.mkdirSync(root, { recursive: true })

  // A root marker, so identity-root discovery has something to find — the same
  // marker a real checkout has.
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture' }))
  for (const file of fs.readdirSync(sourceFixture)) {
    fs.copyFileSync(path.join(sourceFixture, file), path.join(root, file))
  }

  const tsConfigPath = path.join(root, 'tsconfig.json')
  const tsMorphProject = new Project({ tsConfigFilePath: tsConfigPath })
  return {
    root,
    project: {
      tsConfigPath,
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    },
  }
}

function duplicateFindings(project: ArchProject): ArchViolation[] {
  return smells.duplicateBodies(project).withMinSimilarity(0.8).minLines(2).violations()
}

describe('violation identity is portable across checkouts (bug 0010)', () => {
  it('the same code at two different absolute paths produces the same identities', () => {
    const a = materialize('archunit-layout-a-', ['workspace', 'repo'])
    const b = materialize('archunit-layout-b-', ['a', 'much', 'deeper', 'checkout-renamed'])

    const findingsA = duplicateFindings(a.project)
    const findingsB = duplicateFindings(b.project)

    // Vacuity guard: a detector that found nothing would make the set equality
    // below trivially true. This is the check that turns the assertion from
    // decorative into load-bearing.
    expect(findingsA.length).toBeGreaterThan(0)
    expect(findingsB.length).toBe(findingsA.length)
    expect(a.root).not.toBe(b.root)

    const hashesA = new Set(findingsA.map((v) => hashViolation(v, a.root)))
    const hashesB = new Set(findingsB.map((v) => hashViolation(v, b.root)))

    expect([...hashesB].sort()).toEqual([...hashesA].sort())
  })

  it('a baseline generated in one checkout matches every finding in another', () => {
    const a = materialize('archunit-generated-', ['ci', 'workspace'])
    const b = materialize('archunit-consumed-', ['home', 'dev', 'projects', 'other-name'])

    const baselinePath = path.join(a.root, 'arch-baseline.json')
    const findingsA = duplicateFindings(a.project)
    expect(findingsA.length).toBeGreaterThan(0)
    generateBaseline(findingsA, baselinePath)

    // Move the baseline file itself into the other checkout, exactly as a
    // committed baseline travels with the repository.
    const movedBaseline = path.join(b.root, 'arch-baseline.json')
    fs.copyFileSync(baselinePath, movedBaseline)

    const findingsB = duplicateFindings(b.project)
    expect(findingsB.length).toBe(findingsA.length)

    const remaining = withBaseline(movedBaseline).filterNew(findingsB)
    expect(remaining).toEqual([])
  })

  it('stored paths are root-relative, so the file reads the same in both checkouts', () => {
    const a = materialize('archunit-stored-a-', ['one'])
    const b = materialize('archunit-stored-b-', ['two', 'three', 'four'])

    const write = (target: { root: string; project: ArchProject }): string => {
      const out = path.join(target.root, 'arch-baseline.json')
      generateBaseline(duplicateFindings(target.project), out)
      return fs.readFileSync(out, 'utf-8')
    }

    const fileA: unknown = JSON.parse(write(a))
    const fileB: unknown = JSON.parse(write(b))
    const paths = (parsed: unknown): string[] => {
      if (parsed === null || typeof parsed !== 'object' || !('violations' in parsed)) return []
      const { violations } = parsed
      if (!Array.isArray(violations)) return []
      return violations
        .map((v: unknown) =>
          v !== null && typeof v === 'object' && 'file' in v && typeof v.file === 'string'
            ? v.file
            : '',
        )
        .sort()
    }

    expect(paths(fileA).length).toBeGreaterThan(0)
    expect(paths(fileB)).toEqual(paths(fileA))
    // Not merely equal — actually relative, with no traversal out of the repo.
    for (const stored of paths(fileA)) {
      expect(path.isAbsolute(stored)).toBe(false)
      expect(stored.startsWith('..')).toBe(false)
    }
  })

  it('holds when the path is in the rule description rather than the message', () => {
    // A different field, same defect. Any chain scoped by an absolute glob —
    // which is what `strictBoundaries` generates internally from its discovered
    // boundary folders (src/presets/boundaries.ts) — writes the checkout path
    // into `rule`, so identity moves even though the message is clean.
    const a = materialize('archunit-rulefield-a-', ['left'])
    const b = materialize('archunit-rulefield-b-', ['deeper', 'right-renamed'])

    const collect = (target: { root: string; project: ArchProject }): Set<string> => {
      const violations = functions(target.project)
        .that()
        .resideInFile(`${target.root}/file-a.ts`)
        .should()
        .haveNameMatching(/^definitelyNotPresent/)
        .violations()
      // The absolute glob really is in the description — otherwise this test
      // would pass for the boring reason.
      expect(violations.every((v) => v.rule.includes(target.root))).toBe(true)
      return new Set(violations.map((v) => hashViolation(v, target.root)))
    }

    const hashesA = collect(a)
    const hashesB = collect(b)

    expect(hashesA.size).toBeGreaterThan(0)
    expect([...hashesB].sort()).toEqual([...hashesA].sort())
  })
})
