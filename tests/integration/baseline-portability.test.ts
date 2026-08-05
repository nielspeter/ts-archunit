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
import { slices } from '../../src/builders/slice-rule-builder.js'
import { call } from '../../src/helpers/matchers.js'
import { modules } from '../../src/builders/module-rule-builder.js'
import { classes } from '../../src/builders/class-rule-builder.js'
import { calls } from '../../src/builders/call-rule-builder.js'
import { generateBaseline, withBaseline, hashViolation } from '../../src/helpers/baseline.js'
import type { ArchProject } from '../../src/core/project.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { identityCollisions, resetIdentityCollisions } from '../../src/core/violation.js'

const duplicateFixture = path.resolve(import.meta.dirname, '../fixtures/smells/duplicate-bodies')
const siblingFixture = path.resolve(import.meta.dirname, '../fixtures/smells/inconsistent-siblings')
const collisionFixture = path.resolve(
  import.meta.dirname,
  '../fixtures/smells/same-key-object-literals',
)

/** A repository that follows the majority pattern — pure population noise. */
const EXTRA_SIBLING = `export class ExtraRepository {
  private db: Record<string, unknown>[] = []

  getCount(): number {
    const raw = this.db.length
    return this.extractCount(raw)
  }

  private extractCount(value: unknown): number {
    return typeof value === 'number' ? value : 0
  }
}
`

const created: string[] = []

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  }
})

interface Layout {
  root: string
  project: ArchProject
}

interface MaterializeOptions {
  /** Which fixture directory to copy. Defaults to the duplicate-bodies set. */
  fixture?: string
  /** Extra files to write, keyed by path relative to the root. */
  extra?: Record<string, string>
  /**
   * Enumerate source files in reverse. ts-morph resolves tsconfig globs through
   * directory reads, so enumeration order is a property of the filesystem — two
   * machines may legitimately disagree, and identity must not.
   */
  reverseWalk?: boolean
}

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(src, dst)
    else fs.copyFileSync(src, dst)
  }
}

/**
 * Materialise a fixture at a fresh absolute path.
 *
 * `nesting` puts the checkout at a different depth in each layout, which is the
 * part a `path.relative()`-based fix would silently get wrong: relativising
 * encodes `../../..` chains whose length is a property of the machine.
 */
function materialize(prefix: string, nesting: string[], options: MaterializeOptions = {}): Layout {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(tmp)
  const root = path.join(tmp, ...nesting)
  copyDir(options.fixture ?? duplicateFixture, root)

  // A root marker, so identity-root discovery has something to find — the same
  // marker a real checkout has.
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture' }))
  for (const [relative, contents] of Object.entries(options.extra ?? {})) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, contents)
  }

  const tsConfigPath = path.join(root, 'tsconfig.json')
  const tsMorphProject = new Project({ tsConfigFilePath: tsConfigPath })
  const sourceFiles = tsMorphProject.getSourceFiles()
  const ordered = options.reverseWalk === true ? [...sourceFiles].reverse() : sourceFiles
  return {
    root,
    project: { tsConfigPath, _project: tsMorphProject, getSourceFiles: () => ordered },
  }
}

function duplicateFindings(project: ArchProject): ArchViolation[] {
  resetIdentityCollisions()
  return smells.duplicateBodies(project).withMinSimilarity(0.8).minLines(2).violations()
}

function siblingFindings(project: ArchProject): ArchViolation[] {
  return smells
    .inconsistentSiblings(project)
    .forPattern(call('this.extractCount'))
    .minLines(3)
    .violations()
}

const identitiesOf = (findings: ArchViolation[], root: string): Set<string> =>
  new Set(findings.map((v) => hashViolation(v, root)))

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

/**
 * The checkout can stay exactly where it is and identity can still move.
 *
 * These two axes are invisible to every test above — same root, same machine —
 * and to the two-worktree field measurement, which reads one filesystem in one
 * order. Each perturbs the *circumstances* a message describes while leaving
 * the finding itself untouched.
 */
describe('violation identity is stable under unrelated change (bug 0010)', () => {
  it('a pairwise finding keeps its identity when the file walk runs in reverse', () => {
    // ts-morph enumerates tsconfig globs via directory reads. Two machines can
    // legitimately return a different order, which swaps which half of a
    // duplicate pair is reported as the subject: A→B becomes B→A, changing both
    // `element` and `message`.
    const forward = materialize('archunit-walk-fwd-', ['repo'])
    const reverse = materialize('archunit-walk-rev-', ['repo'], { reverseWalk: true })

    const forwardFindings = duplicateFindings(forward.project)
    const reverseFindings = duplicateFindings(reverse.project)

    expect(forwardFindings.length).toBeGreaterThan(0)
    expect(reverseFindings.length).toBe(forwardFindings.length)
    // The orientation really does flip — otherwise this passes for the boring
    // reason and guards nothing.
    expect(reverseFindings.map((v) => v.element)).not.toEqual(forwardFindings.map((v) => v.element))

    const forwardIds = identitiesOf(forwardFindings, forward.root)
    const reverseIds = identitiesOf(reverseFindings, reverse.root)
    expect([...reverseIds].sort()).toEqual([...forwardIds].sort())
  })

  it('a population-derived finding survives an unrelated sibling being added', () => {
    // "3 of 5 files in X use Y" is a fact about the folder, not about the file
    // being reported. Adding a sixth file rewrites it — and with it every
    // already-accepted finding in that folder.
    const before = materialize('archunit-pop-before-', ['repo'], { fixture: siblingFixture })
    const after = materialize('archunit-pop-after-', ['repo'], {
      fixture: siblingFixture,
      extra: { 'repositories/zz-extra-repo.ts': EXTRA_SIBLING },
    })

    const beforeFindings = siblingFindings(before.project)
    const afterFindings = siblingFindings(after.project)

    expect(beforeFindings.length).toBeGreaterThan(0)
    expect(afterFindings.length).toBe(beforeFindings.length)
    // The population text really did change.
    expect(afterFindings[0]?.message).not.toBe(beforeFindings[0]?.message)

    const beforeIds = identitiesOf(beforeFindings, before.root)
    const afterIds = identitiesOf(afterFindings, after.root)
    expect([...afterIds].sort()).toEqual([...beforeIds].sort())
  })

  it('a per-node finding survives lines being inserted above it', () => {
    // The nastiest of the three: with "at line N" in the message, prepending two
    // lines to a file whose matches sit at lines 2 and 4 moves them to 4 and 6 —
    // and the baseline entry recorded for line 4 then matches the violation that
    // used to be at line 2. Coordinate identity does not merely lose entries, it
    // accepts the WRONG one, which is worse than reporting everything as new.
    const body = `export function handler(input: string): string {
  console.log('one')
  const trimmed = input.trim()
  console.log('two')
  return trimmed
}
`
    const tsconfig = JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ES2022', moduleResolution: 'bundler' },
      include: ['*.ts'],
    })
    const build = (prefix: string): Layout => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archunit-shift-'))
      created.push(tmp)
      fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"fixture"}')
      fs.writeFileSync(path.join(tmp, 'tsconfig.json'), tsconfig)
      fs.writeFileSync(path.join(tmp, 'a.ts'), prefix + body)
      const tsConfigPath = path.join(tmp, 'tsconfig.json')
      const tsMorphProject = new Project({ tsConfigFilePath: tsConfigPath })
      return {
        root: tmp,
        project: {
          tsConfigPath,
          _project: tsMorphProject,
          getSourceFiles: () => tsMorphProject.getSourceFiles(),
        },
      }
    }
    const findings = (layout: Layout): ArchViolation[] =>
      modules(layout.project).should().notContain(call('console.log')).violations()

    const plain = build('')
    const shifted = build('// a comment added at the top\n\n')

    const plainFindings = findings(plain)
    const shiftedFindings = findings(shifted)

    // Two distinct findings in one file, distinguished in the message by line
    // alone — the situation that makes this hard.
    expect(plainFindings.length).toBe(2)
    expect(shiftedFindings.length).toBe(2)
    expect(shiftedFindings.map((v) => v.line)).not.toEqual(plainFindings.map((v) => v.line))

    const plainIds = identitiesOf(plainFindings, plain.root)
    const shiftedIds = identitiesOf(shiftedFindings, shifted.root)
    expect(plainIds.size).toBe(2)
    expect([...shiftedIds].sort()).toEqual([...plainIds].sort())
  })

  it('a cycle keeps its identity when the file walk runs in reverse', () => {
    // Tarjan emits an SCC in traversal order, and traversal follows the source
    // walk — so the same cycle reports as `c -> b -> a` on one machine and
    // `b -> a -> c` on another. Rotation only: direction is meaningful, since
    // a -> b -> c and a -> c -> b traverse different edges.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archunit-cycle-'))
    created.push(tmp)
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"fixture"}')
    fs.writeFileSync(
      path.join(tmp, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'ES2022', moduleResolution: 'bundler' },
        include: ['src/**/*'],
      }),
    )
    const ring: Array<{ dir: string; imports: string; fn: string }> = [
      { dir: 'a', imports: 'b', fn: 'b' },
      { dir: 'b', imports: 'c', fn: 'c' },
      { dir: 'c', imports: 'a', fn: 'a' },
    ]
    for (const { dir, imports, fn } of ring) {
      fs.mkdirSync(path.join(tmp, 'src', dir), { recursive: true })
      fs.writeFileSync(
        path.join(tmp, 'src', dir, 'index.ts'),
        `import { ${fn} } from '../${imports}/index.js'\nexport const ${dir} = () => ${fn}()\n`,
      )
    }

    const run = (reverse: boolean): ArchViolation[] => {
      const tsConfigPath = path.join(tmp, 'tsconfig.json')
      const tsMorphProject = new Project({ tsConfigFilePath: tsConfigPath })
      const all = tsMorphProject.getSourceFiles()
      const ordered = reverse ? [...all].reverse() : all
      return slices({ tsConfigPath, _project: tsMorphProject, getSourceFiles: () => ordered })
        .matching('src/')
        .should()
        .beFreeOfCycles()
        .violations()
    }

    const forward = run(false)
    const reversed = run(true)
    expect(forward.length, 'the fixture must actually contain a cycle').toBeGreaterThan(0)
    expect(reversed.length).toBe(forward.length)
    expect(reversed.map((v) => v.message)).toEqual(forward.map((v) => v.message))
    expect(reversed.map((v) => v.element)).toEqual(forward.map((v) => v.element))
  })

  it('every body-analysis family survives lines inserted above (all 8 sites)', () => {
    // The module-level pair was fixed first and the bug report claimed the
    // scope was narrow. It was not: class-level, function-level and the two
    // call-argument families emit one violation per matched node too, all
    // distinguished in the message by `at line N` alone. Review found the
    // other six. This runs one rule per family over the same file, with and
    // without a prefix, and requires the identities to agree.
    const body = `export class Svc {
  handle(input: string): string {
    console.log('a')
    const t = input.trim()
    console.log('b')
    return t
  }
}

export function standalone(input: string): string {
  console.log('c')
  const t = input.trim()
  console.log('d')
  return t
}

export const app = { get: (_p: string, cb: () => void) => cb() }
app.get('/x', () => {
  console.log('e')
  console.log('f')
})
`
    const build = (prefix: string): Layout => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archunit-coords-'))
      created.push(tmp)
      fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"fixture"}')
      fs.writeFileSync(
        path.join(tmp, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { target: 'ES2022', module: 'ES2022', moduleResolution: 'bundler' },
          include: ['*.ts'],
        }),
      )
      fs.writeFileSync(path.join(tmp, 'a.ts'), prefix + body)
      const tsConfigPath = path.join(tmp, 'tsconfig.json')
      const tsMorphProject = new Project({ tsConfigFilePath: tsConfigPath })
      return {
        root: tmp,
        project: {
          tsConfigPath,
          _project: tsMorphProject,
          getSourceFiles: () => tsMorphProject.getSourceFiles(),
        },
      }
    }

    const families: Array<[string, (l: Layout) => ArchViolation[]]> = [
      ['module', (l) => modules(l.project).should().notContain(call('console.log')).violations()],
      ['class', (l) => classes(l.project).should().notContain(call('console.log')).violations()],
      [
        'function',
        (l) => functions(l.project).should().notContain(call('console.log')).violations(),
      ],
      [
        'call-callback',
        (l) =>
          calls(l.project)
            .that()
            .onObject('app')
            .should()
            .notHaveCallbackContaining(call('console.log'))
            .violations(),
      ],
    ]

    const plain = build('')
    const shifted = build('// two lines added at the top\n\n')
    for (const [label, run] of families) {
      const before = run(plain)
      const after = run(shifted)
      // Vacuity: each family must actually produce several findings, or
      // "identities agree" is trivially true.
      expect(before.length, `${label}: findings`).toBeGreaterThan(1)
      expect(after.length, `${label}: findings after shift`).toBe(before.length)
      expect(
        after.map((v) => v.line),
        `${label}: the perturbation must actually move the lines`,
      ).not.toEqual(before.map((v) => v.line))
      expect(
        [...identitiesOf(after, shifted.root)].sort(),
        `${label}: identities must survive the shift`,
      ).toEqual([...identitiesOf(before, plain.root)].sort())
    }
  })

  it('numbering is per declaration, so a new match does not renumber its neighbours', () => {
    // The ordinal is bucketed by enclosing declaration specifically to keep the
    // blast radius local. A single per-file counter would satisfy the test
    // above and still renumber everything downstream of any edit — review
    // showed the bucketing itself was unguarded.
    const withTwo = `export function a(): void {
  console.log('a1')
}
export function b(): void {
  console.log('b1')
  console.log('b2')
}
`
    const withThree = `export function a(): void {
  console.log('a0')
  console.log('a1')
}
export function b(): void {
  console.log('b1')
  console.log('b2')
}
`
    const build = (source: string): Layout => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archunit-bucket-'))
      created.push(tmp)
      fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"fixture"}')
      fs.writeFileSync(
        path.join(tmp, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { target: 'ES2022', module: 'ES2022', moduleResolution: 'bundler' },
          include: ['*.ts'],
        }),
      )
      fs.writeFileSync(path.join(tmp, 'a.ts'), source)
      const tsConfigPath = path.join(tmp, 'tsconfig.json')
      const tsMorphProject = new Project({ tsConfigFilePath: tsConfigPath })
      return {
        root: tmp,
        project: {
          tsConfigPath,
          _project: tsMorphProject,
          getSourceFiles: () => tsMorphProject.getSourceFiles(),
        },
      }
    }

    const idsIn = (layout: Layout, fnName: string): string[] =>
      modules(layout.project)
        .should()
        .notContain(call('console.log'))
        .violations()
        .filter((v) => (v.identity ?? '').includes(`::${fnName}::`))
        .map((v) => hashViolation(v, layout.root))
        .sort()

    const before = build(withTwo)
    const after = build(withThree)

    expect(idsIn(before, 'b'), 'b must have findings to compare').toHaveLength(2)
    // A match added inside `a` must leave `b`'s identities alone.
    expect(idsIn(after, 'b')).toEqual(idsIn(before, 'b'))
    // And `a` itself legitimately gains one.
    expect(idsIn(after, 'a').length).toBe(idsIn(before, 'a').length + 1)
  })

  it('two findings from one rule never share an identity', () => {
    // `identity` replaces element AND message in the hash, so a producer that
    // picks too coarse a form silently merges distinct findings: accepting one
    // in a baseline would accept the other. Collision is the failure mode this
    // primitive introduces, so it gets its own guard.
    //
    // The fixture matters more than the assertion here. An earlier cut pointed
    // at duplicate-bodies/, which yields exactly ONE finding — so `1 === 1`
    // held for any identity function at all, including a literal constant, the
    // worst possible implementation. This fixture yields several findings from
    // one rule in one file, including two object literals that share a key
    // name, which is the shape that actually collided (measured: 3 findings, 2
    // identities, before the owning-binding prefix).
    const layout = materialize('archunit-collision-', ['repo'], {
      fixture: collisionFixture,
    })
    const findings = duplicateFindings(layout.project)

    // Vacuity guard with teeth: one finding can never collide with anything.
    expect(findings.length, 'the fixture must produce several findings').toBeGreaterThan(2)
    expect(identitiesOf(findings, layout.root).size).toBe(findings.length)

    // **The assertion above no longer measures this producer**, and this one does.
    //
    // `disambiguateIdentities` guarantees distinct identities for every rule, so
    // `size === length` became true for all possible input the day it landed. Measured:
    // collapsing this producer's identity to a literal constant left the entire suite green,
    // including this row — whose own comment says collision "is the failure mode this
    // primitive introduces, so it gets its own guard".
    //
    // `identityCollisions()` reports what the mechanism had to repair, so a producer that
    // stops identifying its findings is visible again. Zero is the assertion: this producer is
    // expected to be correct on its own, with the mechanism as a net it never needs.
    expect(
      identityCollisions().filter((c) => c.rule.includes('duplicate')),
      'duplicateBodies must produce distinct identities WITHOUT relying on disambiguation',
    ).toEqual([])
  })

  it('distinguishes same-named keys in different object literals', () => {
    // The specific collision above, asserted on the names rather than the
    // count, so a regression says which half broke.
    const layout = materialize('archunit-samekey-', ['repo'], { fixture: collisionFixture })
    const elements = duplicateFindings(layout.project).map((v) => v.element)

    expect(elements.length).toBeGreaterThan(0)
    // Every reported element is qualified by the binding that owns its literal.
    for (const element of elements) {
      expect(element, 'object-literal findings must name their owning binding').toMatch(
        /^(routeA|routeB|routeC)\./,
      )
    }
    // Both `handler` keys are represented — they are not merged into one.
    expect(elements.some((e) => e.startsWith('routeA.'))).toBe(true)
    expect(elements.some((e) => e.startsWith('routeB.'))).toBe(true)
  })
})
