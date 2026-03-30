import picomatch from 'picomatch'
import type { ArchProject } from '../core/project.js'
import type { ArchViolation } from '../core/violation.js'
import { slices } from '../builders/slice-rule-builder.js'
import { modules } from '../builders/module-rule-builder.js'
import { smells } from '../smells/index.js'
import type { PresetBaseOptions } from './shared.js'
import { dispatchRule, validateOverrides, throwIfViolations } from './shared.js'

export interface StrictBoundariesOptions extends PresetBaseOptions {
  /** Glob pattern for boundary folders (e.g., 'src/features/*') */
  folders: string
  /** Glob patterns for shared folders accessible by all boundaries */
  shared?: string[]
  /** If true, test files cannot import from other boundaries' tests */
  isolateTests?: boolean
  /** If true, warn on copy-pasted function bodies across boundaries */
  noCopyPaste?: boolean
}

const RULE_IDS = [
  'preset/boundaries/no-cycles',
  'preset/boundaries/no-cross-boundary',
  'preset/boundaries/shared-isolation',
  'preset/boundaries/test-isolation',
  'preset/boundaries/no-duplicate-bodies',
] as const

/**
 * Collect violations for shared-folder isolation rules.
 */
function applySharedIsolation(
  p: ArchProject,
  sharedGlobs: string[],
  boundaryFolders: string[],
  overrides: StrictBoundariesOptions['overrides'],
): ArchViolation[] {
  const violations: ArchViolation[] = []
  for (const sharedGlob of sharedGlobs) {
    for (const dir of boundaryFolders) {
      violations.push(
        ...dispatchRule(
          modules(p).that().resideInFolder(sharedGlob).should().notImportFrom(`${dir}/**`),
          'preset/boundaries/shared-isolation',
          'error',
          overrides,
        ),
      )
    }
  }
  return violations
}

/**
 * Collect violations for test-isolation rules across boundaries.
 */
function applyTestIsolation(
  p: ArchProject,
  boundaryFolders: string[],
  overrides: StrictBoundariesOptions['overrides'],
): ArchViolation[] {
  const violations: ArchViolation[] = []
  for (const dir of boundaryFolders) {
    const testPattern = `${dir}/**/*.test.*`
    const otherBoundaryTests = boundaryFolders
      .filter((d) => d !== dir)
      .map((d) => `${d}/**/*.test.*`)

    for (const otherTestGlob of otherBoundaryTests) {
      violations.push(
        ...dispatchRule(
          modules(p).that().resideInFile(testPattern).should().notImportFrom(otherTestGlob),
          'preset/boundaries/test-isolation',
          'error',
          overrides,
        ),
      )
    }
  }
  return violations
}

/**
 * Enforce strict module boundaries: no cycles, no cross-boundary imports,
 * shared isolation, and optional copy-paste detection.
 */
export function strictBoundaries(p: ArchProject, options: StrictBoundariesOptions): void {
  const overrides = options.overrides
  validateOverrides(overrides, [...RULE_IDS])

  const sharedGlobs = options.shared ?? []
  const violations: ArchViolation[] = []

  // Discover boundary folders from the glob pattern
  const boundaryGlob = options.folders
  const matcher = picomatch(boundaryGlob)
  const boundaryFolders: string[] = []
  for (const sf of p.getSourceFiles()) {
    const dir = sf.getFilePath().replace(/\/[^/]+$/, '')
    if (matcher(dir) && !boundaryFolders.includes(dir)) {
      boundaryFolders.push(dir)
    }
  }

  // Build a slice definition from discovered boundaries
  const sliceDef: Record<string, string> = {}
  for (const dir of boundaryFolders) {
    const name = dir.split('/').pop() ?? dir
    sliceDef[name] = `${dir}/**`
  }

  // --- No cycles between boundaries ---
  if (Object.keys(sliceDef).length > 0) {
    violations.push(
      ...dispatchRule(
        slices(p).assignedFrom(sliceDef).should().beFreeOfCycles(),
        'preset/boundaries/no-cycles',
        'error',
        overrides,
      ),
    )
  }

  // --- No cross-boundary imports ---
  // Each boundary folder: modules in it can only import from itself + shared
  for (const dir of boundaryFolders) {
    const boundaryPattern = `${dir}/**`
    const allowedGlobs = [boundaryPattern, ...sharedGlobs]

    violations.push(
      ...dispatchRule(
        modules(p)
          .that()
          .resideInFolder(boundaryPattern)
          .should()
          .onlyImportFrom(...allowedGlobs),
        'preset/boundaries/no-cross-boundary',
        'error',
        overrides,
      ),
    )
  }

  // --- Shared isolation: shared folders don't import from boundaries ---
  violations.push(...applySharedIsolation(p, sharedGlobs, boundaryFolders, overrides))

  // --- Test isolation ---
  if (options.isolateTests) {
    violations.push(...applyTestIsolation(p, boundaryFolders, overrides))
  }

  // --- No copy-paste across boundaries ---
  if (options.noCopyPaste) {
    violations.push(
      ...dispatchRule(
        smells.duplicateBodies(p),
        'preset/boundaries/no-duplicate-bodies',
        'warn',
        overrides,
      ),
    )
  }

  throwIfViolations(violations)
}
