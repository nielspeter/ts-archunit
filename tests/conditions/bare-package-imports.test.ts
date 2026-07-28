/**
 * Bug 0014 — a bare package name matched nothing when the package was installed.
 *
 * `resolveImportPath` returned the resolved path **or** the raw specifier, so a
 * package that resolves (i.e. one you actually depend on) was only ever tested
 * as `.../node_modules/@types/foo/index.d.ts`, which `'foo'` never matches. The
 * documented way to ban a dependency worked only on dependencies you had not
 * installed.
 *
 * Every test here is written to fail against the old behaviour. Ask ADR-008's
 * question of the pre-existing dependency suite — *what would it do if bare
 * specifiers matched nothing?* — and the answer was "pass, entirely": there was
 * no test anywhere for a bare specifier, because every fixture used path globs.
 */
import path from 'node:path'
import picomatch from 'picomatch'
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import {
  onlyImportFrom,
  notImportFrom,
  dependOn,
  onlyHaveTypeImportsFrom,
} from '../../src/conditions/dependency.js'
// A namespace import, not an alias: `notImportFrom` exists as both a predicate
// and a condition, and this repo's own `hygiene/no-aliased-imports` rule bans
// `as` renaming in test files — it caught this the moment it was written,
// which is the rule working.
import * as modulePredicates from '../../src/predicates/module.js'
import { importCandidates, matchedCandidate } from '../../src/core/import-candidates.js'
import { layeredArchitecture } from '../../src/presets/layered.js'
import type { ArchProject } from '../../src/core/project.js'
import type { ConditionContext } from '../../src/core/condition.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/bare-imports')
const tsMorphProject = new Project({
  tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
})

function fixture(relativePath: string) {
  const full = path.join(fixturesDir, relativePath)
  const sf = tsMorphProject.getSourceFile(full)
  if (!sf) throw new Error(`Fixture not found: ${full}`)
  return sf
}

const ctx: ConditionContext = { rule: 'test rule' }

describe('bug 0014 — bare package specifiers', () => {
  it('the installed-package fixture really does resolve', () => {
    // Load-bearing precondition. If picomatch stopped resolving, every test
    // below would still pass while testing the unresolvable path instead —
    // the exact false green that let the bug ship.
    const [decl] = fixture('src/installed-package.ts').getImportDeclarations()
    expect(decl?.getModuleSpecifierValue()).toBe('picomatch')
    expect(decl?.getModuleSpecifierSourceFile()?.getFilePath()).toContain('node_modules')
  })

  describe('notImportFrom — a ban', () => {
    it('fires on a bare name for an INSTALLED package', () => {
      const violations = notImportFrom('picomatch').evaluate(
        [fixture('src/installed-package.ts')],
        ctx,
      )
      expect(violations).toHaveLength(1)
      // The message names what the user wrote, not the @types path they have
      // never seen. ADR-008 rule 2: the finding has to be actionable.
      expect(violations[0]?.message).toContain('"picomatch"')
      expect(violations[0]?.message).not.toContain('node_modules')
    })

    it('still fires on a bare name for an uninstalled package', () => {
      const violations = notImportFrom('no-such-package-xyz').evaluate(
        [fixture('src/missing-package.ts')],
        ctx,
      )
      expect(violations).toHaveLength(1)
    })

    it('still fires on a path glob against the resolved path', () => {
      const violations = notImportFrom('**/picomatch/**').evaluate(
        [fixture('src/installed-package.ts')],
        ctx,
      )
      expect(violations).toHaveLength(1)
      // Unchanged text: the resolved path is tested first, so a finding that
      // existed before this fix keeps its message — and therefore its baseline
      // identity, which is a hash of the message.
      expect(violations[0]?.message).toContain('node_modules')
    })

    it('does not match a RELATIVE specifier as a raw string', () => {
      // '../services/*' matches nothing against an absolute path. If relative
      // specifiers were offered as candidates it would match here, relative
      // globs would silently half-work, and plan 0069's `unanchored` fault
      // would stop being diagnosable.
      const violations = notImportFrom('../services/*').evaluate(
        [fixture('src/app/consumer.ts')],
        ctx,
      )
      expect(violations).toHaveLength(0)
    })

    it('still matches a relative import by its resolved path', () => {
      const violations = notImportFrom('**/services/**').evaluate(
        [fixture('src/app/consumer.ts')],
        ctx,
      )
      expect(violations).toHaveLength(1)
    })
  })

  describe('the PREDICATES, not just the conditions', () => {
    // `importFrom`/`notImportFrom` as selectors had no bare-specifier test at
    // all, so reverting `importCandidatePaths` to one candidate per import
    // left the suite green — and a selector matching nothing is precisely
    // plan 0069's subject.
    it('importFrom selects a module importing an installed package by bare name', () => {
      const sf = fixture('src/installed-package.ts')
      expect(modulePredicates.importFrom('picomatch').test(sf)).toBe(true)
      expect(modulePredicates.notImportFrom('picomatch').test(sf)).toBe(false)
    })

    it('and still selects on a path glob', () => {
      const sf = fixture('src/installed-package.ts')
      expect(modulePredicates.importFrom('**/picomatch/**').test(sf)).toBe(true)
    })

    it('does not select a relative specifier by its raw string', () => {
      expect(
        modulePredicates.importFrom('../services/*').test(fixture('src/app/consumer.ts')),
      ).toBe(false)
    })
  })

  describe('onlyHaveTypeImportsFrom', () => {
    it('matches a bare name for an installed package', () => {
      // The fourth production call site, also revertible with the suite green.
      const violations = onlyHaveTypeImportsFrom('picomatch').evaluate(
        [fixture('src/installed-package.ts')],
        ctx,
      )
      expect(violations).toHaveLength(1)
    })
  })

  describe('the allowlist family flips the other way, deliberately', () => {
    it('onlyImportFrom accepts a bare name that it used to reject', () => {
      // This is the red -> green half of the break. Before the fix, no matcher
      // could match the resolved @types path, so an allowlist naming the
      // package by name still reported a violation. Anyone who worked around
      // that by allowlisting the node_modules path keeps working — both
      // candidates are tested — but the natural spelling now passes.
      const violations = onlyImportFrom('picomatch').evaluate(
        [fixture('src/installed-package.ts')],
        ctx,
      )
      expect(violations).toHaveLength(0)
    })

    it('onlyImportFrom still rejects a package outside the allowlist', () => {
      const violations = onlyImportFrom('**/services/**').evaluate(
        [fixture('src/installed-package.ts')],
        ctx,
      )
      expect(violations).toHaveLength(1)
    })

    it('dependOn is satisfied by a bare name', () => {
      const violations = dependOn('picomatch').evaluate([fixture('src/installed-package.ts')], ctx)
      expect(violations).toHaveLength(0)
    })
  })

  describe('the layered preset, whose documented use this unblocks', () => {
    // `restrictedPackages` is documented as "glob -> list of npm package name
    // patterns", and that is precisely the spelling bug 0014 killed: an npm
    // package you have installed resolves, so the bare name matched nothing
    // and the rule certified nothing. The preset's own tests never caught it
    // because all three pass PATH globs where the API asks for package names —
    // the same avoidance that hid the bug in the dependency suite.
    const archProject: ArchProject = {
      tsConfigPath: path.join(fixturesDir, 'tsconfig.json'),
      _project: tsMorphProject,
      getSourceFiles: () => tsMorphProject.getSourceFiles(),
    }

    it('restricts a real npm package by its bare name', () => {
      const rules = layeredArchitecture(archProject, {
        layers: { app: '**/app/**', services: '**/services/**' },
        // Only `services/` may use picomatch. `installed-package.ts` is in
        // neither layer, so it must be reported.
        restrictedPackages: { '**/services/**': ['picomatch'] },
      })
      const violations = rules.flatMap((rule) => rule.violations())
      expect(violations.map((v) => v.ruleId)).toContain('preset/layered/restricted-packages')
    })

    it('permits the package inside the layer that owns it', () => {
      // Written in the commit that FIXED bug 0014, and vacuous: the allowed
      // glob covered every file, so the preset generated a rule with no
      // subjects and `[]` violations was trivially true. It would have passed
      // with restrictedPackages entirely broken.
      //
      // Now it is two-sided. The same package and the same importer, with only
      // the allowed layer moved — so a pass on the second half means the rule
      // ran and found nothing, not that it had nothing to run over.
      const restrictedTo = (allowed: string) =>
        layeredArchitecture(archProject, {
          layers: { app: '**/app/**', services: '**/services/**' },
          restrictedPackages: { [allowed]: ['picomatch'] },
        })
          .flatMap((rule) => rule.violations())
          .filter((v) => v.ruleId === 'preset/layered/restricted-packages')

      // Positive control: the importer is NOT in `app/`, so it is reported.
      expect(restrictedTo('**/app/**').length).toBeGreaterThan(0)

      // And permitted once the allowed layer is the one holding the import.
      expect(restrictedTo('**/bare-imports/src')).toEqual([])
    })
  })

  describe('importCandidates', () => {
    it('offers the resolved path and the bare specifier, primary first', () => {
      const [decl] = fixture('src/installed-package.ts').getImportDeclarations()
      if (!decl) throw new Error('no import declaration')
      const candidates = importCandidates(decl)
      expect(candidates).toHaveLength(2)
      expect(candidates[0]).toContain('node_modules')
      expect(candidates[1]).toBe('picomatch')
    })

    it('offers only the specifier when the import does not resolve', () => {
      const [decl] = fixture('src/missing-package.ts').getImportDeclarations()
      if (!decl) throw new Error('no import declaration')
      expect([...importCandidates(decl)]).toEqual(['no-such-package-xyz'])
    })

    it('offers only the resolved path for a relative specifier', () => {
      const [decl] = fixture('src/app/consumer.ts').getImportDeclarations()
      if (!decl) throw new Error('no import declaration')
      const candidates = importCandidates(decl)
      expect(candidates).toHaveLength(1)
      expect(candidates[0]).toContain('/services/helper.ts')
    })

    it('matchedCandidate returns the PRIMARY when both candidates match', () => {
      // This is the property that keeps violation messages — and therefore
      // baseline identities — stable. Nothing else in the suite asserts a
      // dependency violation's exact message text, so without this the
      // "baselines are unaffected" claim rests on reading the code.
      const [decl] = fixture('src/installed-package.ts').getImportDeclarations()
      if (!decl) throw new Error('no import declaration')
      const candidates = importCandidates(decl)
      const matchEverything = picomatch('**')
      expect(matchEverything(candidates[0])).toBe(true)
      expect(matchEverything('picomatch')).toBe(true)
      expect(matchedCandidate(candidates, [matchEverything])).toBe(candidates[0])
    })

    it('keeps the primary candidate identical to the pre-fix resolution, corpus-wide', () => {
      // The invariant that protects every existing baseline: violation messages
      // interpolate the primary candidate, and `hashViolation` hashes the
      // message. Checked against this repo's own source rather than a fixture,
      // so it covers relative imports, bare packages, subpath imports and
      // type-only imports as they actually occur.
      const realProject = new Project({ tsConfigFilePath: 'tsconfig.json' })
      let checked = 0
      for (const sourceFile of realProject.getSourceFiles()) {
        for (const decl of sourceFile.getImportDeclarations()) {
          const resolved = decl.getModuleSpecifierSourceFile()
          const beforeTheFix = resolved ? resolved.getFilePath() : decl.getModuleSpecifierValue()
          expect(importCandidates(decl)[0]).toBe(beforeTheFix)
          checked++
        }
      }
      // Guard the guard: an empty corpus would pass this loop trivially.
      expect(checked).toBeGreaterThan(500)
    })
  })
})
