import type { SourceFile } from 'ts-morph'
import type { ArchProject } from '../core/project.js'
import type { RuleBuilderLike } from '../core/rule-builder-like.js'
import { not } from '../core/combinators.js'
import { resideInFolder as resideInFolderPredicate } from '../predicates/identity.js'
import { slices } from '../builders/slice-rule-builder.js'
import { modules } from '../builders/module-rule-builder.js'
import type { PresetBaseOptions } from './shared.js'
import { collectRule, validateOverrides } from './shared.js'

export interface LayeredArchitectureOptions extends PresetBaseOptions {
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
  overrides: LayeredArchitectureOptions['overrides'],
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
          overrides,
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
  overrides: LayeredArchitectureOptions['overrides'],
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
    // Modules NOT in any allowed layer must not import this package
    const builder = modules(p).that()
    for (const allowedGlob of allowedLayers) {
      builder.satisfy(not(resideInFolderPredicate<SourceFile>(allowedGlob)))
    }

    builders.push(
      ...collectRule(
        builder.should().notImportFrom(pkg),
        {
          id: 'preset/layered/restricted-packages',
          because:
            'this layer is meant to be independent of that package, so importing it here spreads the dependency past the layer that owns it',
          suggestion:
            'Move the call into the layer permitted to use the package and expose the result through a function or interface this layer may depend on.',
          imperative: 'Do NOT import a restricted package in this layer',
        },
        'error',
        overrides,
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
  const overrides = options.overrides
  validateOverrides(overrides, [...RULE_IDS])

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
        .respectLayerOrder(...layerNames),
      {
        id: 'preset/layered/layer-order',
        because:
          'an import against the declared layer order inverts the architecture — the outer layer becomes a dependency of the inner one',
        suggestion:
          'Depend inwards only. Move the shared piece into the inner layer, or invert the call with an interface the inner layer declares and the outer implements.',
        imperative: 'Do NOT import outwards across layers — depend inwards only',
      },
      'error',
      overrides,
    ),
  )

  // --- No cycles ---
  builders.push(
    ...collectRule(
      slices(p).assignedFrom(layerDef).should().beFreeOfCycles(),
      {
        id: 'preset/layered/no-cycles',
        because:
          'layers in a cycle have no order, so the layering they are declared with means nothing',
        suggestion:
          'Break the cycle at its weakest edge: move the shared type into the inner layer, or invert one direction with an interface.',
        imperative: 'Do NOT create an import cycle between layers',
      },
      'error',
      overrides,
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
            .onlyImportFrom(...allowedGlobs),
          {
            id: 'preset/layered/innermost-isolation',
            because:
              'the innermost layer is the one everything else depends on, so any dependency it takes is inherited by the entire system',
            suggestion:
              'Keep it self-contained: move the dependency outwards, or express what it needs as an interface the innermost layer declares and an outer layer implements.',
            imperative: 'Do NOT add dependencies to the innermost layer',
          },
          'error',
          overrides,
        ),
      )
    }
  }

  // --- Type imports only for specified layers ---
  if (options.typeImportsAllowed && options.typeImportsAllowed.length > 0) {
    builders.push(...applyTypeImportRules(p, options.typeImportsAllowed, layerGlobs, overrides))
  }

  // --- Restricted packages ---
  if (options.restrictedPackages) {
    builders.push(...applyRestrictedPackages(p, options.restrictedPackages, overrides))
  }

  return builders
}
