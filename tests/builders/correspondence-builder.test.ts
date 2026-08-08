import fs from 'node:fs'
import path from 'node:path'
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
import {
  type TestElement,
  TestRuleBuilder,
  stubProject,
  nameMatches,
} from '../support/test-rule-builder.js'

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

    it('.expectEmpty(side) declares an empty side, and it stays green', () => {
      const emptySel = new TestRuleBuilder(stubProject, elements)
        .that()
        .withPredicate(nameMatches(/^NothingMatches$/))
      expect(() => {
        correspondence(stubProject)
          .side('services', emptySel, byNameKey)
          .side('registry', ['UserService'])
          .expectEmpty('services')
          .beComplete()
          .check()
      }).not.toThrow()
    })

    it('the zero-argument form is refused at build time — plan 0097', () => {
      // It used to inherit TerminalBuilder's whole-rule flag, which suppressed
      // the empty finding for BOTH sides and which the expiry branch never
      // read: `allowEmpty` restored, permanent and silent, in fewer characters
      // than before, on the release that deleted it. A correspondence compares
      // two named sides, so "this rule is empty" has no per-rule meaning.
      expect(() => correspondence(stubProject).side('a', []).side('b', []).expectEmpty()).toThrow(
        TypeError,
      )
    })

    it('a declaration naming no side is a failing finding, not a silent no-op', () => {
      // The typo case. ADR-009 part 3 rules the identical preset case a FAILING
      // finding, never a warning — a declaration that binds to nothing asserts
      // nothing, and saying so is the whole difference from `allowEmpty`.
      const v = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService'])
        .expectEmpty('servcies') // typo
        .beComplete()
        .violations()
      // NOT the length — under an inverted filter the typo case also yields
      // exactly one violation (the real `beComplete` finding), so `1 === 1`
      // passes on that sabotage. The substring is what carries this row.
      expect(v[0]!.message).toContain("sides are 'services' and 'registry'")
      expect(v[0]!.bypassFilters).toBe(true)
      // The remedy names the ACTION, and is pinned separately from the message,
      // which names the facts. The census proves whose remedy it is; only this
      // proves what it says — and an agent handed facts with no imperative
      // invents one.
      expect(v[0]!.suggestion).toContain(
        "Correct the side name to one of 'services' and 'registry'",
      )

      // Applying the stated remedy: spell it correctly. The unbound finding
      // clears — and the rule is still red, with a DIFFERENT finding, because
      // `services` genuinely is not empty so the corrected declaration has
      // genuinely expired. Asserted rather than filtered, because a filtered
      // empty list would also pass if `violations()` returned nothing at all.
      const fixed = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService'])
        .expectEmpty('services')
        .beComplete()
        .violations()
      // The declaration finding FIRST, and the rule's real finding still under
      // it. This row asserted `toHaveLength(1)`, which encoded a defect rather
      // than a decision: a false declaration used to short-circuit the whole
      // comparison, so `services "OrderService" has no matching registry` — a
      // genuine finding, on a run the user had made stricter — was discarded.
      // Both are reported now, configuration first.
      expect(fixed[0]!.message).toContain('was declared empty')
      expect(fixed.map((x) => x.message).join('\n')).toContain('has no matching registry')

      // The remedy's OTHER branch — remove the declaration — is the one an
      // agent takes, and it clears everything.
      const removed = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService'])
        .beComplete()
        .violations()
      expect(removed.filter((x) => x.message.includes('binds to nothing'))).toEqual([])
      expect(removed.filter((x) => x.message.includes('was declared empty'))).toEqual([])
    })

    it('one bad name in BOTH declaration sets is ONE finding', () => {
      // Concatenating the two sets produced two findings with identical element,
      // message, file and line — the identity shape bugs 0064, 0065 and 0067 were
      // filed for, where `hashViolation` keys both to one baseline entry and the
      // terminal prints the same sentence twice.
      const v = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService'])
        .expectEmpty('typo')
        .distinctKeysOn('typo')
        .beComplete()
        .violations()
      expect(v.map((x) => x.element)).toEqual(['typo'])
    })

    it('two unbound names report two findings, by identity', () => {
      // The `.map()`'s identity property: one finding per bad name, not one
      // per rule. Catches a future "report only the first" simplification.
      const v = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService'])
        .expectEmpty('servcies')
        .distinctKeysOn('registrees')
        .beComplete()
        .violations()
      expect(v.map((x) => x.element)).toEqual(['servcies', 'registrees'])
    })

    it('distinctKeysOn() with an unbound name is caught by the same check', () => {
      const v = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService'])
        .distinctKeysOn('registrees') // typo
        .beComplete()
        .violations()
      expect(v.map((x) => x.element)).toEqual(['registrees'])
    })

    it('.expectEmpty(side) FAILS the day that side fills up — plan 0097', () => {
      // The property that makes it an assertion rather than `allowEmpty()`'s
      // permission, which had no failing state and so stayed green forever.
      const v = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService'])
        .expectEmpty('services')
        .beComplete()
        .violations()
      // Identity, not count: the declaration finding is first and unsuppressable,
      // and the comparison it was hiding still runs. `toHaveLength(1)` here was
      // pinning the swallowing described above.
      expect(v[0]!.message).toContain('was declared empty')
      expect(v[0]!.bypassFilters).toBe(true)
      expect(v.map((x) => x.message).join('\n')).toContain('has no matching registry')
    })

    it('the expiry remedy remediates: removing the declaration clears it', () => {
      // ADR-008 rule 2's behavioural corollary — apply the stated fix and assert
      // the finding clears, rather than asserting the sentence reads well.
      const withoutDeclaration = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService'])
        .beComplete()
        .violations()
      expect(withoutDeclaration.filter((x) => x.message.includes('was declared empty'))).toEqual([])
    })

    it('declaring EVERY side is not a loop: it does not red asking to declare', () => {
      // Per-side membership carries this on its own — a `declaresEmpty()` helper
      // with an `every(...)` disjunct stood here and was unreachable, and this
      // test passed with it deleted. Kept because the BEHAVIOUR is what matters
      // (a user who declared everything must not be told to declare), but the
      // credit now goes to the mechanism that actually provides it.
      const emptyA = new TestRuleBuilder(stubProject, elements)
        .that()
        .withPredicate(nameMatches(/^NothingMatches$/))
      expect(() => {
        correspondence(stubProject)
          .side('a', emptyA, byNameKey)
          .side('b', [])
          .expectEmpty('a')
          .expectEmpty('b')
          .beComplete()
          .check()
      }).not.toThrow()
    })

    it('every side declared and NON-empty: per-side expiry only, never a whole-rule one', () => {
      // Plan 0099's floor puts the expiry at the ROOT, and it reads
      // `_expectEmpty` rather than `declaresEmpty()`. Six lines of comment defend
      // that choice and NOTHING falsified it: swapping the two branches produced
      // 0 failures across 3305 tests, measured by two reviewers independently.
      //
      // The difference is reachable here. `CorrespondenceBuilder.declaresEmpty()`
      // is an all-sides conjunction and this class reports its own per-side
      // expiry, so reading it at the root would emit a THIRD, whole-rule finding
      // on top of the two per-side ones — the double-report the root's sole
      // ownership exists to prevent. Worse, that finding's own text would be
      // self-contradicting: `emptyDeclarationAdvice()` here returns
      // `.expectEmpty(sideName) for each side`, so it would say
      // "`.expectEmpty(sideName) for each side` asserted this RULE examines
      // nothing" — a claim this class refuses to make by design.
      const vs = correspondence(stubProject)
        .side('services', services(), byNameKey)
        .side('registry', ['UserService', 'OrderService'])
        .expectEmpty('services')
        .expectEmpty('registry')
        .beComplete()
        .violations()
      const config = vs.filter((v) => v.bypassFilters === true)
      // Per side, by identity — a count alone would accept the whole-rule finding
      // in place of one of them.
      expect(config.map((v) => v.element).sort()).toEqual(['registry', 'services'])
      expect(config.every((v) => !v.message.includes('asserted this rule examines nothing'))).toBe(
        true,
      )
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
        .expectEmpty('a') // a produced no keys — declared, so not a finding
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

    it('wrong arity is a finding even WITH an assertion chosen (bug 0025)', () => {
      // REVERSED from "throws when there are not exactly two sides". The
      // RangeError was reachable through a terminal whenever an assertion was
      // chosen, and it escaped the CLI's ArchRuleError-only catch and dropped
      // every remaining rule file's findings — the sibling branch of the same
      // fault 0.23.0 fixed for the no-assertion case, left behind because
      // `assertsSomething()` read only the assertion flags.
      //
      // `.beComplete()` on one side cannot assert anything: there is no second
      // side to compare against. So the fault reports identically either way.
      const rule = correspondence(stubProject).side('a', ['x']).beComplete()
      expect(rule.assertsSomething()).toBe(false)
      const v = rule.violations()
      expect(v).toHaveLength(1)
      expect(v[0]?.bypassFilters).toBe(true)
      expect(v[0]?.message).toContain('1 side(s) and needs exactly two')
      // The remedy is another side, NOT an assertion — it already has one, and
      // naming `.beComplete()` here would leave the rule exactly as broken.
      expect(v[0]?.message).toContain('.side(')
      expect(v[0]?.message).not.toContain('.beComplete()')
      expect(() => rule.check()).toThrow(ArchRuleError)
      expect(() => rule.check()).not.toThrow(RangeError)
    })

    it('the arity invariant survives on collectViolations for a direct caller', () => {
      // The throw is now unreachable through every terminal, so this asserts it
      // is still THERE rather than that it fires: the method indexes _sides[0]
      // and _sides[1] non-null, and a subclass calling it directly should get
      // the named error rather than an undefined read. Reading the source is the
      // only way to check a branch the terminals cannot reach — a test that
      // called a terminal here would be measuring the gate instead.
      const source = fs.readFileSync(
        path.resolve(import.meta.dirname, '../../src/builders/correspondence-builder.ts'),
        'utf-8',
      )
      expect(source).toContain('requires exactly two .side(...) calls')
    })

    it('reports a finding when no assertion is chosen (bug 0019, was a throw)', () => {
      // CHANGED at 0.23.0: this was a bare RangeError, which escaped the CLI's
      // ArchRuleError-only catch and dropped every remaining rule file. It is
      // now a configuration finding, so it formats, baselines, annotates and
      // exits like every other finding.
      const rule = correspondence(stubProject).side('a', ['x']).side('b', ['x'])
      const v = rule.violations()
      expect(v).toHaveLength(1)
      expect(v[0]?.bypassFilters).toBe(true)
      expect(v[0]?.message).toContain('.beComplete()')
      expect(() => rule.check()).toThrow(ArchRuleError)
      expect(() => rule.check()).not.toThrow(RangeError)
    })

    it('the remedy remediates: adding .beComplete() clears the finding', () => {
      const v = correspondence(stubProject)
        .side('a', ['x'])
        .side('b', ['x'])
        .beComplete()
        .violations()
      expect(v.every((x) => x.bypassFilters !== true)).toBe(true)
    })

    it('wrong arity still names arity, not an assertion', () => {
      // Two faults reach the same hook, and naming the wrong one is ADR-008
      // rule 2: adding .beComplete() here would leave the rule as broken.
      const v = correspondence(stubProject).side('a', ['x']).violations()
      expect(v).toHaveLength(1)
      expect(v[0]?.message).toContain('.side(')
      expect(v[0]?.message).not.toContain('.beComplete()')
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
        .side(
          'fields',
          classes(p)
            .that()
            .haveNameMatching(/Limits/),
          byPropertyNames(),
        )
        .side('enforced', ['a', 'b']) // 'c' has no enforcement
        .beComplete()
        .violations()
      expect(v).toHaveLength(1)
      expect(v[0]!.message).toBe('fields "c" has no matching enforced')
      expect(v[0]!.file).toMatch(/limits\.ts$/)
    })
  })
})
