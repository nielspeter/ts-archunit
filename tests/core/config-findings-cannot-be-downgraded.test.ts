/**
 * A configuration finding cannot be silenced (plan 0069 R3a).
 *
 * A `bypassFilters` finding reports that the rule enforces **nothing**. That
 * is not a violation the author gets to grade, and there were four ways to
 * quiet it: three already refused (`.excluding()` explicitly, baseline and
 * diff by honouring the flag), one did not.
 *
 * Five producers set no severity at all, so on the `.warn()` path every one of
 * them resolved to `warn` — a finding saying "this rule can never fire",
 * reported as advice, on the surface the docs recommend for gradual adoption.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { Project } from 'ts-morph'
import { modules } from '../../src/index.js'
import { applyFilters } from '../../src/core/execute-rule.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/modules')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}
const p = loadProject()

/** A rule that can never have subjects, so it produces a config finding. */
const vacuous = () =>
  modules(p)
    .that()
    .resideInFolder('**/nowhere-at-all/**')
    .expectNonEmpty()
    .should()
    .notHaveDefaultExport()

/** A rule with real subjects and a real violation. */
const violating = () =>
  modules(p).that().resideInFolder('**/bad/**').should().notHaveAliasedImports()

function silenceWarnings(): string[] {
  const written: string[] = []
  const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    written.push(args.map(String).join(' '))
  })
  onTestFinished(() => {
    spy.mockRestore()
  })
  return written
}

describe('.warn()', () => {
  it('throws for a configuration finding', () => {
    silenceWarnings()
    expect(() => {
      vacuous().warn()
    }).toThrow(ArchRuleError)
  })

  it('still does not throw for ordinary violations', () => {
    // The contract that must survive: `.warn()` is advisory for violations.
    // Only the finding that the rule cannot fire is exempt.
    const logged = silenceWarnings()
    expect(() => {
      violating().warn()
    }).not.toThrow()
    expect(logged.join('')).not.toBe('')
  })

  it('throws carrying ONLY the configuration findings', () => {
    // An error carrying every warn-level violation alongside would make R3's
    // "these findings are true" false for most of its entries, and recreate
    // the noise problem in the release that fixes it.
    silenceWarnings()
    try {
      modules(p)
        .that()
        .resideInFolder('**/nowhere-at-all/**')
        .expectNonEmpty()
        .should()
        .notHaveDefaultExport()
        .warn()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      if (error instanceof ArchRuleError) {
        expect(error.violations).toHaveLength(1)
        expect(error.violations.every((v) => v.bypassFilters === true)).toBe(true)
        // Severity `error`, on the WARN path. This is the only place the
        // `stampSeverity` floor is observable: `check()` stamps 'error'
        // anyway, so without this assertion that floor can be deleted with
        // the suite green — and the finding would be carried, and reported,
        // as advice.
        expect(error.violations[0]?.severity).toBe('error')
      }
    }
  })

  it('logs the ordinary violations before throwing', () => {
    // Both kinds in one rule: the reader still gets the advisory output on the
    // surface they chose, and only the config finding reaches the error.
    const logged = silenceWarnings()
    try {
      modules(p)
        .that()
        .resideInFolder('**/nowhere-at-all/**')
        .expectNonEmpty()
        .should()
        .notHaveDefaultExport()
        .warn()
    } catch {
      // expected
    }
    expect(logged.join('')).toContain('0 subjects')
  })
})

describe('the aliases inherit it', () => {
  it('.severity("warn") throws too — it literally calls .warn()', () => {
    silenceWarnings()
    expect(() => {
      vacuous().severity('warn')
    }).toThrow(ArchRuleError)
  })

  it('.asSeverity("warn") cannot downgrade the finding on the check path', () => {
    silenceWarnings()
    try {
      vacuous().asSeverity('warn').check()
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ArchRuleError)
      if (error instanceof ArchRuleError) {
        expect(error.violations[0]?.severity).toBe('error')
      }
    }
  })

  it('.asSeverity("warn") cannot downgrade it on the .violations() path either', () => {
    // The second stamping site. `.violations()` overwrites severity
    // unconditionally, so it needed the floor independently of the
    // `?? severity` path.
    const found = vacuous().asSeverity('warn').violations()
    expect(found).toHaveLength(1)
    expect(found[0]?.severity).toBe('error')
  })

  it('an ordinary violation IS still downgraded by .asSeverity("warn")', () => {
    // Guard the guard: a floor that flooring everything would pass the tests
    // above while breaking the feature.
    const found = violating().asSeverity('warn').violations()
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((v) => v.severity === 'warn')).toBe(true)
  })
})

describe('the fifth suppression surface', () => {
  it('an inline exclusion comment cannot suppress a configuration finding', () => {
    // Tested at `applyFilters`, which is where the guard lives, rather than
    // through a builder: `evaluate()` returns early on an empty subject set,
    // so a pipeline cannot currently deliver a config finding that carries a
    // real file path — which is exactly why these were immune by accident and
    // not by design. They carry `file: ''`, the comment scan cannot read `''`,
    // and nothing about that is a decision anyone made.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archunit-ignore-'))
    onTestFinished(() => {
      fs.rmSync(dir, { recursive: true, force: true })
    })
    const file = path.join(dir, 'thing.ts')
    fs.writeFileSync(file, '// ts-archunit-exclude test/rule: deliberate\nexport const x = 1\n')

    const configFinding: ArchViolation = {
      rule: 'test',
      ruleId: 'test/rule',
      element: 'test/rule',
      file,
      line: 2,
      message: 'Selector matched 0 subjects',
      bypassFilters: true,
    }
    const ordinary: ArchViolation = {
      rule: 'test',
      ruleId: 'test/rule',
      element: 'x',
      file,
      line: 2,
      message: 'an ordinary violation',
    }

    const kept = applyFilters([configFinding, ordinary], { metadata: { id: 'test/rule' } })

    // The comment silences the ordinary violation — that is its job — and
    // cannot touch the finding that says the rule enforces nothing.
    expect(kept.map((v) => v.message)).toEqual(['Selector matched 0 subjects'])
  })
})
