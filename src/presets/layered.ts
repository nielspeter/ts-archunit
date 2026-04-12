import type { SourceFile } from 'ts-morph'
import type { ArchProject } from '../core/project.js'
import type { ArchViolation } from '../core/violation.js'
import { not } from '../core/combinators.js'
import { resideInFolder as resideInFolderPredicate } from '../predicates/identity.js'
import { slices } from '../builders/slice-rule-builder.js'
import { modules } from '../builders/module-rule-builder.js'
import type { PresetBaseOptions } from './shared.js'
import { dispatchRule, validateOverrides, throwIfViolations } from './shared.js'

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
): ArchViolation[] {
  const violations: ArchViolation[] = []
  for (const layerGlob of typeImportsAllowed) {
    const otherLayerGlobs = layerGlobs.filter((g) => g !== layerGlob)
    if (otherLayerGlobs.length > 0) {
      violations.push(
        ...dispatchRule(
          modules(p)
            .that()
            .resideInFolder(layerGlob)
            .should()
            .onlyHaveTypeImportsFrom(...otherLayerGlobs),
          'preset/layered/type-imports-only',
          'warn',
          overrides,
        ),
      )
    }
  }
  return violations
}

/**
 * Collect violations for restricted-package rules.
 */
function applyRestrictedPackages(
  p: ArchProject,
  restrictedPackages: Record<string, string[]>,
  overrides: LayeredArchitectureOptions['overrides'],
): ArchViolation[] {
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

  const violations: ArchViolation[] = []
  for (const [pkg, allowedLayers] of packageToAllowed) {
    // Modules NOT in any allowed layer must not import this package
    const builder = modules(p).that()
    for (const allowedGlob of allowedLayers) {
      builder.satisfy(not(resideInFolderPredicate<SourceFile>(allowedGlob)))
    }

    violations.push(
      ...dispatchRule(
        builder.should().notImportFrom(pkg),
        'preset/layered/restricted-packages',
        'error',
        overrides,
      ),
    )
  }
  return violations
}

/**
 * Enforce a layered architecture: dependency direction, cycle freedom,
 * and optional package restrictions.
 */
export function layeredArchitecture(p: ArchProject, options: LayeredArchitectureOptions): void {
  const overrides = options.overrides
  validateOverrides(overrides, [...RULE_IDS])

  const layerNames = Object.keys(options.layers)
  const layerGlobs = Object.values(options.layers)
  const sharedGlobs = options.shared ?? []
  const violations: ArchViolation[] = []

  // --- Layer order (slices) ---
  const layerDef: Record<string, string> = {}
  for (const [name, glob] of Object.entries(options.layers)) {
    layerDef[name] = glob
  }

  violations.push(
    ...dispatchRule(
      slices(p)
        .assignedFrom(layerDef)
        .should()
        .respectLayerOrder(...layerNames),
      'preset/layered/layer-order',
      'error',
      overrides,
    ),
  )

  // --- No cycles ---
  violations.push(
    ...dispatchRule(
      slices(p).assignedFrom(layerDef).should().beFreeOfCycles(),
      'preset/layered/no-cycles',
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

      violations.push(
        ...dispatchRule(
          modules(p)
            .that()
            .resideInFolder(innermostGlob)
            .should()
            .onlyImportFrom(...allowedGlobs),
          'preset/layered/innermost-isolation',
          'error',
          overrides,
        ),
      )
    }
  }

  // --- Type imports only for specified layers ---
  if (options.typeImportsAllowed && options.typeImportsAllowed.length > 0) {
    violations.push(...applyTypeImportRules(p, options.typeImportsAllowed, layerGlobs, overrides))
  }

  // --- Restricted packages ---
  if (options.restrictedPackages) {
    violations.push(...applyRestrictedPackages(p, options.restrictedPackages, overrides))
  }

  throwIfViolations(violations)
}
