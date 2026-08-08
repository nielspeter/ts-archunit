import type { SourceFile } from 'ts-morph'
import type { ImportOptions } from '../core/import-options.js'
import type { ArchProject } from '../core/project.js'
import type { RuleBuilderLike } from '../core/rule-builder-like.js'
import { not } from '../core/combinators.js'
import { resideInFolder as resideInFolderPredicate } from '../predicates/identity.js'
import { slices } from '../builders/slice-rule-builder.js'
import { modules } from '../builders/module-rule-builder.js'
import type { PresetBaseOptions } from './shared.js'
import {
  collectRule,
  overrideFindings,
  validateOverrides,
  declaredEmptyFindings,
} from './shared.js'

/** This preset's rule ids, derived from `RULE_IDS` so the two cannot drift. */
export type LayeredArchitectureRuleId = (typeof RULE_IDS)[number]

export interface LayeredArchitectureOptions extends PresetBaseOptions<LayeredArchitectureRuleId> {
  /** Layer name → glob pattern mapping. Order = dependency direction (first depends on second, etc.) */
  layers: Record<string, string>
  /** Glob patterns for shared/utility folders accessible by all layers */
  shared?: string[]
  /** If true, innermost layer only imports from itself + shared */
  strict?: boolean
  /** Layers where cross-layer type imports are allowed (value imports still forbidden) */
  typeImportsAllowed?: string[]
  /** Package restriction: glob → list of npm package name patterns. Only those layers may import those packages. */
  restrictedPackages?: Record<string, string[]>
  /**
   * This project's answer to "is a type-only edge a dependency?", applied to
   * every rule this preset constructs **whose condition takes one** — plan 0089:
   * `layer-order`, `no-cycles`, `innermost-isolation`, `restricted-packages`.
   * `type-imports-only` is excluded because `onlyHaveTypeImportsFrom` asks about
   * type imports *as its subject* — there is no answer for this bag to give it.
   *
   * The conditions disagree by default, deliberately: `beFreeOfCycles` ignores
   * type-only imports because it asks whether the module is *evaluated*, and an
   * erased import cannot contribute to an initialization cycle; the layer and
   * boundary conditions count them because they ask whether the code is
   * *coupled*. Holding a builder, that distinction is visible and you choose per
   * condition. Through a preset it is invisible, and this option exists because
   * a preset user could not align them even when their project wanted them
   * aligned.
   *
   * So passing it moves exactly one side, and which side depends on the value:
   * `{ ignoreTypeImports: true }` stops the layer rules counting type coupling
   * (the cycle rule already ignored it); `{ ignoreTypeImports: false }` makes
   * the cycle rule count type edges (the layer rules already did). `docs/presets.md`
   * carries that table.
   */
  importOptions?: ImportOptions
}

const RULE_IDS = [
  'preset/layered/layer-order',
  'preset/layered/no-cycles',
  'preset/layered/innermost-isolation',
  'preset/layered/type-imports-only',
  'preset/layered/restricted-packages',
] as const

/**
 * Collect violations for type-import-only rules on specified layers.
 */
function applyTypeImportRules(
  p: ArchProject,
  typeImportsAllowed: string[],
  layerGlobs: string[],
  config: LayeredArchitectureOptions,
  constructed: string[],
): RuleBuilderLike[] {
  const builders: RuleBuilderLike[] = []
  for (const layerGlob of typeImportsAllowed) {
    const otherLayerGlobs = layerGlobs.filter((g) => g !== layerGlob)
    if (otherLayerGlobs.length > 0) {
      builders.push(
        ...collectRule(
          modules(p)
            .that()
            .resideInFolder(layerGlob)
            .should()
            .onlyHaveTypeImportsFrom(...otherLayerGlobs),
          {
            id: 'preset/layered/type-imports-only',
            because:
              'a runtime import from this layer creates a real dependency, where a type-only import creates none and disappears at compile time',
            suggestion:
              'Use `import type { X }` so the dependency is erased, or move the value you need into a layer this one is allowed to depend on.',
            imperative: 'Use `import type` for cross-layer imports from this layer',
          },
          'warn',
          config,
          constructed,
        ),
      )
    }
  }
  return builders
}

/**
 * Collect violations for restricted-package rules.
 */
function applyRestrictedPackages(
  p: ArchProject,
  restrictedPackages: Record<string, string[]>,
  config: LayeredArchitectureOptions,
  constructed: string[],
): RuleBuilderLike[] {
  // Invert: for each package, find which layers are allowed
  const packageToAllowed = new Map<string, string[]>()
  for (const [layerGlob, packages] of Object.entries(restrictedPackages)) {
    for (const pkg of packages) {
      const existing = packageToAllowed.get(pkg)
      if (existing) {
        existing.push(layerGlob)
      } else {
        packageToAllowed.set(pkg, [layerGlob])
      }
    }
  }

  const builders: RuleBuilderLike[] = []
  for (const [pkg, allowedLayers] of packageToAllowed) {
    // Modules NOT in any allowed layer must not import this package.
    //
    // `builder = builder.satisfy(...)`, not a bare call: since bug 0016 a
    // builder is immutable, so discarding the return discards the predicate.
    // This was the only site in the codebase relying on the old mutation, and
    // it is the reason the fix is a behaviour change rather than a refactor.
    let builder = modules(p).that()
    for (const allowedGlob of allowedLayers) {
      builder = builder.satisfy(not(resideInFolderPredicate<SourceFile>(allowedGlob)))
    }

    builders.push(
      ...collectRule(
        builder.should().notImportFromWithOptions([pkg], config.importOptions ?? {}),
        {
          id: 'preset/layered/restricted-packages',
          because:
            'this layer is meant to be independent of that package, so importing it here spreads the dependency past the layer that owns it',
          suggestion:
            'Move the call into the layer permitted to use the package and expose the result through a function or interface this layer may depend on.',
          imperative: 'Do NOT import a restricted package in this layer',
        },
        'error',
        config,
        constructed,
      ),
    )
  }
  return builders
}

/**
 * Enforce a layered architecture: dependency direction, cycle freedom,
 * and optional package restrictions.
 */
export function layeredArchitecture(
  p: ArchProject,
  options: LayeredArchitectureOptions,
): RuleBuilderLike[] {
  const config = options
  const constructed: string[] = []
  validateOverrides(config.overrides, [...RULE_IDS])
  const overrideProblems = overrideFindings(config.overrides, RULE_IDS)

  const layerNames = Object.keys(options.layers)
  const layerGlobs = Object.values(options.layers)
  const sharedGlobs = options.shared ?? []
  const builders: RuleBuilderLike[] = []

  // --- Layer order (slices) ---
  const layerDef: Record<string, string> = {}
  for (const [name, glob] of Object.entries(options.layers)) {
    layerDef[name] = glob
  }

  builders.push(
    ...collectRule(
      slices(p)
        .assignedFrom(layerDef)
        .should()
        .respectLayerOrder(layerNames, options.importOptions ?? {}),
      {
        id: 'preset/layered/layer-order',
        because:
          'an import against the declared layer order inverts the architecture — the outer layer becomes a dependency of the inner one',
        suggestion:
          'Depend inwards only. Move the shared piece into the inner layer, or invert the call with an interface the inner layer declares and the outer implements.',
        imperative: 'Do NOT import outwards across layers — depend inwards only',
      },
      'error',
      config,
      constructed,
    ),
  )

  // --- No cycles ---
  builders.push(
    ...collectRule(
      slices(p).assignedFrom(layerDef).should().beFreeOfCycles(options.importOptions),
      {
        id: 'preset/layered/no-cycles',
        because:
          'layers in a cycle have no order, so the layering they are declared with means nothing. Since v0.48.0 a cycle formed by `export … from` (a barrel) IS detected; dynamic `import()` still is not, deliberately, because it is lazy and is usually the fix rather than the fault.',
        suggestion:
          'Break the cycle at its weakest edge: move the shared type into the inner layer, or invert one direction with an interface.',
        imperative: 'Do NOT create an import cycle between layers',
      },
      'error',
      config,
      constructed,
    ),
  )

  // --- Innermost isolation (strict mode) ---
  if (options.strict && layerNames.length > 0) {
    const innermostName = layerNames[layerNames.length - 1]
    const innermostGlob = innermostName !== undefined ? options.layers[innermostName] : undefined
    if (innermostName && innermostGlob) {
      const allowedGlobs = [innermostGlob, ...sharedGlobs]

      builders.push(
        ...collectRule(
          modules(p)
            .that()
            .resideInFolder(innermostGlob)
            .should()
            // Forwarded, like `respectLayerOrder` and `beFreeOfCycles`. This is
            // an isolation rule and `docs/presets.md` promises the option reaches
            // them; measured before the fix, `{ ignoreTypeImports: true }` cleared
            // `layer-order` and left `innermost-isolation` reporting the SAME
            // erased edge — one preset answering the project's one question twice.
            .onlyImportFromWithOptions(allowedGlobs, options.importOptions ?? {}),
          {
            id: 'preset/layered/innermost-isolation',
            because:
              'the innermost layer is the one everything else depends on, so any dependency it takes is inherited by the entire system',
            suggestion:
              'Keep it self-contained: move the dependency outwards, or express what it needs as an interface the innermost layer declares and an outer layer implements.',
            imperative: 'Do NOT add dependencies to the innermost layer',
          },
          'error',
          config,
          constructed,
        ),
      )
    }
  }

  // --- Type imports only for specified layers ---
  if (options.typeImportsAllowed && options.typeImportsAllowed.length > 0) {
    builders.push(
      ...applyTypeImportRules(p, options.typeImportsAllowed, layerGlobs, config, constructed),
    )
  }

  // --- Restricted packages ---
  if (options.restrictedPackages) {
    builders.push(...applyRestrictedPackages(p, options.restrictedPackages, config, constructed))
  }

  // Unknown override keys FIRST: they say the configuration is wrong, which
  // the reader needs before any finding produced under it (bug 0038).
  // Constructed, not merely known: a rule whose option was never enabled, or that
  // was overridden `off`, is not built — so a declaration naming it is dead.
  return [
    ...overrideProblems,
    ...declaredEmptyFindings(config.expectEmpty, constructed),
    ...builders,
  ]
}
