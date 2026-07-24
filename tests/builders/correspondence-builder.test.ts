import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import { ArchRuleError } from '../../src/core/errors.js'
import {
  correspondence,
  byName,
  byArg,
  byPropertyNames,
} from '../../src/builders/correspondence-builder.js'
import { classes } from '../../src/builders/class-rule-builder.js'
import { calls } from '../../src/builders/call-rule-builder.js'
import type { ArchProject } from '../../src/core/project.js'
import { type TestElement, TestRuleBuilder, stubProject, nameMatches } from '../support/test-rule-builder.js'

function inMemoryProject(files: Record<string, string>): ArchProject {
  const project = new Project({ useInMemoryFileSystem: true })
  for (const [name, code] of Object.entries(files)) project.createSourceFile(name, code)
  return {
    tsConfigPath: 'in-memory',
    _project: project,
    getSourceFiles: () => project.getSourceFiles(),
  }
}

const elements: TestElement[] = [
  { name: 'UserService', file: 'src/services/user.ts', line: 5, exported: true },
  { name: 'OrderService', file: 'src/services/order.ts', line: 3, exported: true },
  { name: 'helperFn', file: 'src/helpers/util.ts', line: 1, exported: false },
]

/** A selection of the two *Service elements, keyed by name. */
function services(): TestRuleBuilder {
  return new TestRuleBuilder(stubProject, elements).that().withPredicate(nameMatches(/Service$/))
}
const byNameKey = (e: TestElement): string => e.name

describe('correspondence()', () => {
  describe('.beComplete() — A ⊆ B (coverage)', () => {
    it('passes when every A key has a B match', () => {
      expect(() => {
        correspondence(stubProject)
          .side('services', services(), byNameKey)
          .side('registry', ['UserService', 'OrderService', 'Extra'])
          .should()
          .beComplete()
          .check()
      }).not.toThrow()
    })

    it('fails, naming the uncovered A key, when a match is missing', () => {
      const v = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService'])
        .beComplete()
        .violations()
      expect(v).toHaveLength(1)
      expect(v[0]!.element).toBe('OrderService')
      expect(v[0]!.message).toBe('services "OrderService" has no matching registry')
    })
  })

  describe('.haveNoOrphans() — B ⊆ A', () => {
    it('flags a B key with no A source', () => {
      const v = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService', 'OrderService', 'Ghost'])
        .haveNoOrphans()
        .violations()
      expect(v.map((x) => x.element)).toEqual(['Ghost'])
      expect(v[0]!.message).toBe('registry "Ghost" has no matching services')
    })
  })

  describe('.beBijective() — both directions', () => {
    it('passes only when the key sets are identical', () => {
      expect(() => {
        correspondence(stubProject)
          .side('services', services(), byNameKey)
          .side('registry', ['UserService', 'OrderService'])
          .beBijective()
          .check()
      }).not.toThrow()
    })

    it('reports both a missing and an orphan (identity, not cardinality)', () => {
      // same count on both sides, but one dropped + one added
      const v = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService', 'Ghost'])
        .beBijective()
        .violations()
      expect(v).toHaveLength(2) // exactly the missing + the orphan, nothing spurious
      const msgs = v.map((x) => x.message)
      expect(msgs).toContain('services "OrderService" has no matching registry')
      expect(msgs).toContain('registry "Ghost" has no matching services')
    })
  })

  describe('non-vacuity (ADR-008)', () => {
    it('fails when a selection side is empty, and does not run the coverage flood', () => {
      const emptySel = new TestRuleBuilder(stubProject, elements)
        .that()
        .withPredicate(nameMatches(/^NothingMatches$/))
      const v = correspondence(stubProject)
        .side('services', emptySel, byNameKey)
        .side('registry', ['UserService'])
        .beComplete()
        .violations()
      expect(v).toHaveLength(1)
      expect(v[0]!.element).toBe('services')
      expect(v[0]!.message).toMatch(/matched 0 subjects/)
    })

    it('fails when a keys side is empty', () => {
      const v = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', [])
        .beComplete()
        .violations()
      expect(v).toHaveLength(1)
      expect(v[0]!.element).toBe('registry')
    })

    it('.allowEmpty() opts a side out of the non-vacuity guard', () => {
      const emptySel = new TestRuleBuilder(stubProject, elements)
        .that()
        .withPredicate(nameMatches(/^NothingMatches$/))
      expect(() => {
        correspondence(stubProject)
          .side('services', emptySel, byNameKey)
          .side('registry', ['UserService'])
          .allowEmpty('services')
          .beComplete()
          .check()
      }).not.toThrow()
    })
  })

  describe('.distinctKeysOn() — over-normalization guard', () => {
    it('fails per collapsed subject when a side maps distinct subjects to one key', () => {
      const base = () =>
        correspondence(stubProject)
          .side('a', new TestRuleBuilder(stubProject, elements).that(), () => 'same')
          .side('b', ['same'])
          .beComplete()
      const withGuard = base().distinctKeysOn('a').violations()
      // every element collapsed to the single key "same" → one finding each
      expect(withGuard).toHaveLength(elements.length)
      expect(withGuard.every((x) => /over-normalization/.test(x.message))).toBe(true)
      // opt-in: without .distinctKeysOn() the collapse is not flagged (beComplete passes)
      expect(base().violations()).toEqual([])
    })
  })

  describe('multi-key / empty keyFn', () => {
    it('a keyFn returning [] contributes no keys (subject deliberately vanishes)', () => {
      const v = correspondence(stubProject)
        .side('a', services(), () => [])
        .side('b', ['UserService'])
        .allowEmpty('a') // a produced no keys — permitted here
        .haveNoOrphans()
        .violations()
      // a is empty; b's only key has no source in a → one orphan
      expect(v.map((x) => x.element)).toEqual(['UserService'])
    })
  })

  describe('terminals + errors', () => {
    it('.check() throws ArchRuleError on violations', () => {
      expect(() => {
        correspondence(stubProject)
          .side('services', services(), byNameKey)
          .side('registry', ['UserService'])
          .beComplete()
          .check()
      }).toThrow(ArchRuleError)
    })

    it('throws when there are not exactly two sides', () => {
      expect(() => {
        correspondence(stubProject).side('a', ['x']).beComplete().check()
      }).toThrow(/exactly two/)
    })

    it('throws when no assertion is chosen', () => {
      expect(() => {
        correspondence(stubProject).side('a', ['x']).side('b', ['x']).check()
      }).toThrow(/requires an assertion/)
    })

    it('a selection side requires a keyFn', () => {
      // @ts-expect-error — keyFn is required for a selection source
      expect(() => correspondence(stubProject).side('s', services())).toThrow(/requires a keyFn/)
    })

    it('propagates rule metadata to violations (agent payload)', () => {
      const v = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService'])
        .beComplete()
        .because('routes must be registered')
        .rule({ id: 'route/matrix', suggestion: 'add it to the registry' })
        .violations()
      expect(v[0]!.ruleId).toBe('route/matrix')
      expect(v[0]!.because).toBe('routes must be registered')
      expect(v[0]!.suggestion).toBe('add it to the registry')
    })
  })

  describe('keyFn vocabulary', () => {
    it('byName() keys by getName(), with <anonymous> fallback', () => {
      expect(byName<{ getName(): string | undefined }>()({ getName: () => 'X' })).toBe('X')
      expect(byName<{ getName(): string | undefined }>()({ getName: () => undefined })).toBe(
        '<anonymous>',
      )
    })

    it('byArg(i) keys by the argument, unquoting string/template literals', () => {
      const call = {
        getArguments: () => [{ getText: () => '"/users/:id"' }, { getText: () => 'handler' }],
      }
      expect(byArg<typeof call>(0)(call)).toBe('/users/:id') // surrounding quotes stripped
      expect(byArg<typeof call>(1)(call)).toBe('handler') // non-literal left as-is
      expect(byArg<typeof call>(9)(call)).toBe('<no-arg>')
    })

    it('byPropertyNames() keys a type by each property name (one subject → many keys)', () => {
      const iface = { getProperties: () => [{ getName: () => 'a' }, { getName: () => 'b' }] }
      expect(byPropertyNames<typeof iface>()(iface)).toEqual(['a', 'b'])
    })
  })

  describe('on a real project (location adapter)', () => {
    it('attaches real file:line from a ts-morph subject to the violation', () => {
      const p = inMemoryProject({
        'src/a.ts': 'export class Alpha {}\n',
        'src/b.ts': 'export class Beta {}\n',
      })
      const v = correspondence(p)
        .side('classes', classes(p).that(), byName())
        .side('registry', ['Alpha']) // Beta is missing
        .beComplete()
        .violations()
      expect(v).toHaveLength(1)
      expect(v[0]!.element).toBe('Beta')
      expect(v[0]!.file).toMatch(/b\.ts$/)
      expect(v[0]!.line).toBe(1)
    })

    it('attaches file:line via a model-wrapper subject (ArchCall.getNode) + unquoted byArg', () => {
      const p = inMemoryProject({
        'src/routes.ts':
          'declare const app: { get(p: string, h: () => void): void }\n' +
          'app.get("/a", () => {})\n' +
          'app.get("/b", () => {})\n',
      })
      const v = correspondence(p)
        .side('routes', calls(p).that().onObject('app').and().withMethod('get'), byArg(0))
        .side('registry', ['/a']) // '/b' missing — byArg unquotes, so keys are '/a','/b'
        .beComplete()
        .violations()
      expect(v).toHaveLength(1)
      expect(v[0]!.message).toContain('/b')
      expect(v[0]!.file).toMatch(/routes\.ts$/)
      expect(v[0]!.line).toBe(3) // the app.get("/b") call — not '' / 0 (would mean the adapter failed)
    })

    it('fans out one subject to many keys via byPropertyNames (multi-key keyFn)', () => {
      const p = inMemoryProject({
        'src/limits.ts': 'export class Limits { a = 1; b = 2; c = 3 }\n',
      })
      const v = correspondence(p)
        .side('fields', classes(p).that().haveNameMatching(/Limits/), byPropertyNames())
        .side('enforced', ['a', 'b']) // 'c' has no enforcement
        .beComplete()
        .violations()
      expect(v).toHaveLength(1)
      expect(v[0]!.message).toBe('fields "c" has no matching enforced')
      expect(v[0]!.file).toMatch(/limits\.ts$/)
    })
  })
})
