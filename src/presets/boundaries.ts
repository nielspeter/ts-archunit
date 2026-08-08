import type { SourceFile } from 'ts-morph'
import type { ImportOptions } from '../core/import-options.js'
import picomatch from 'picomatch'
import type { ArchProject } from '../core/project.js'
import type { RuleBuilderLike } from '../core/rule-builder-like.js'
import { slices } from '../builders/slice-rule-builder.js'
import { modules } from '../builders/module-rule-builder.js'
import { smells } from '../smells/index.js'
import type { PresetBaseOptions } from './shared.js'
import {
  atPath,
  collectRule,
  overrideFindings,
  validateOverrides,
  assertDiscovered,
  declaredEmptyFindings,
} from './shared.js'

/** This preset's rule ids, derived from `RULE_IDS` so the two cannot drift. */
export type StrictBoundariesRuleId = (typeof RULE_IDS)[number]

export interface StrictBoundariesOptions extends PresetBaseOptions<StrictBoundariesRuleId> {
  /** Glob pattern for boundary folders (e.g., 'src/features/*') */
  folders: string
  /** Glob patterns for shared folders accessible by all boundaries */
  shared?: string[]
  /** If true, test files cannot import from other boundaries' tests */
  isolateTests?: boolean
  /** If true, warn on copy-pasted function bodies across boundaries */
  noCopyPaste?: boolean
  /**
   * This project's answer to "is a type-only edge a dependency?", applied to
   * every rule this preset constructs **whose condition takes one** — plan 0089:
   * `no-cycles`, `no-cross-boundary`, `shared-isolation`, `test-isolation`.
   * `no-duplicate-bodies` is excluded because it compares function bodies, not imports.
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
  'preset/boundaries/shared-discovery',
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
  config: StrictBoundariesOptions,
  constructed: string[],
): RuleBuilderLike[] {
  const builders: RuleBuilderLike[] = []
  for (const sharedGlob of sharedGlobs) {
    for (const dir of boundaryFolders) {
      builders.push(
        ...collectRule(
          modules(p)
            .that()
            .satisfy(atPath<SourceFile>(sharedGlob, 'shared'))
            .should()
            .notImportFromWithOptions([`${dir}/**`], config.importOptions ?? {}),
          {
            id: 'preset/boundaries/shared-isolation',
            because:
              'shared code is imported by every boundary, so a dependency from shared back into one of them couples all of them to it',
            suggestion:
              'Invert the dependency: move what shared needs into shared, or pass it in as a parameter or interface from the boundary that owns it.',
            imperative: 'Do NOT import a boundary from shared code — invert the dependency',
          },
          'error',
          config,
          constructed,
        ),
      )
    }
  }
  return builders
}

/**
 * Collect violations for test-isolation rules across boundaries.
 */
function applyTestIsolation(
  p: ArchProject,
  boundaryFolders: string[],
  config: StrictBoundariesOptions,
  constructed: string[],
): RuleBuilderLike[] {
  const builders: RuleBuilderLike[] = []
  for (const dir of boundaryFolders) {
    const testPattern = `${dir}/**/*.test.*`
    const otherBoundaryTests = boundaryFolders
      .filter((d) => d !== dir)
      .map((d) => `${d}/**/*.test.*`)

    for (const otherTestGlob of otherBoundaryTests) {
      builders.push(
        ...collectRule(
          modules(p)
            .that()
            .resideInFile(testPattern)
            .should()
            .notImportFromWithOptions([otherTestGlob], config.importOptions ?? {}),
          {
            id: 'preset/boundaries/test-isolation',
            because:
              "one boundary's tests reaching into another's makes the two impossible to move, delete or run independently",
            suggestion:
              'Duplicate the small fixture it needs, or promote the shared helper into a test-support module both boundaries may import.',
            imperative:
              "Do NOT import another boundary's tests — duplicate the fixture or share it explicitly",
          },
          'error',
          config,
          constructed,
        ),
      )
    }
  }
  return builders
}

/**
 * Enforce strict module boundaries: no cycles, no cross-boundary imports,
 * shared isolation, and optional copy-paste detection.
 */
export function strictBoundaries(
  p: ArchProject,
  options: StrictBoundariesOptions,
): RuleBuilderLike[] {
  const config = options
  const constructed: string[] = []
  validateOverrides(config.overrides, [...RULE_IDS])
  const overrideProblems = overrideFindings(config.overrides, RULE_IDS)

  const sharedGlobs = options.shared ?? []
  const builders: RuleBuilderLike[] = []

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

  // --- Discovery guard: a boundaries preset that finds no boundaries is
  //     misconfigured (globs match absolute paths — a project-relative glob
  //     matches nothing). Fail loudly instead of generating zero rules
  //     (the exact false green of ADR-008 / plan 0067), rather than the old
  //     silent skip. ---
  builders.push(
    ...assertDiscovered(boundaryFolders, {
      id: 'preset/boundaries/discovery',
      glob: boundaryGlob,
      remedy:
        `Boundary discovery matches absolute file paths, so '${boundaryGlob}' matched nothing. ` +
        `Use a '**/'-prefixed glob (e.g. '**/${boundaryGlob.replace(/^[./]+/, '')}') or the absolute project path.`,
    }),
  )

  // --- Discovery guard for `shared`, mirroring the one above for `folders` ---
  //
  // `shared` globs go RAW into `no-cross-boundary`'s allow list and are matched
  // by picomatch against absolute resolved file paths. A glob that matches no
  // file creates no allowance — and produced no finding at all, so the user
  // learned about it only through false reds on the exact code the preset's own
  // docs tell them to write. Measured on `boundaries-folder-level`:
  //
  //   shared: ['**/src/shared/**']    shared import passes, 0 config findings
  //   shared: ['src/shared/**']       shared import FLAGGED, 0 config findings
  //   shared: ['**/no-such-dir/**']   shared import FLAGGED, 0 config findings
  //   folders: 'src/features/*'       0 rules,              1 config finding
  //
  // The last row is the contract `shared` was missing: `folders` fails loudly on
  // a spelling that matches nothing, and the two options sat on one preset
  // holding the caller to two different contracts (bug 0023). Note that the
  // middle two rows are indistinguishable from outside — same violation count,
  // no explanation — which is what the guard fixes.
  //
  // A GUARD, deliberately not normalization. `folders` is not normalized either;
  // its remedy states the absolute-path contract and tells the caller how to
  // spell it. Rewriting `shared` globs instead would make one option on this
  // preset accept a spelling the other rejects, which is a worse asymmetry than
  // the one being fixed.
  //
  // Matched against FILE paths, not `atPath`'s file-or-folder: the allow list is
  // what this guard is about, and `onlyImportFrom` matches resolved file paths.
  // `shared: ['**/src/shared']` — a folder glob with no `/**` — selects files for
  // `shared-isolation` via `atPath` yet creates no allowance, so it is a genuine
  // fault here and the guard must fire for it.
  for (const sharedGlob of sharedGlobs) {
    const matchesFile = picomatch(sharedGlob)
    const matchedFiles = p.getSourceFiles().filter((sf) => matchesFile(sf.getFilePath()))
    builders.push(
      ...assertDiscovered(matchedFiles, {
        id: 'preset/boundaries/shared-discovery',
        glob: sharedGlob,
        remedy:
          `A shared glob is matched against absolute file paths, so '${sharedGlob}' matched no file and ` +
          `creates no allowance — every import of it is reported as a cross-boundary violation. ` +
          `Use a '**/'-prefixed glob ending in '/**' (e.g. '**/${sharedGlob.replace(/^[./]+/, '').replace(/\/\*\*$/, '')}/**') or the absolute project path.`,
      }),
    )
  }

  // --- No cycles between boundaries ---
  if (Object.keys(sliceDef).length > 0) {
    builders.push(
      ...collectRule(
        slices(p).assignedFrom(sliceDef).should().beFreeOfCycles(options.importOptions),
        {
          id: 'preset/boundaries/no-cycles',
          because:
            'boundaries in a cycle cannot be built, tested, released or reasoned about separately, which is the whole point of having them. Since v0.48.0 a cycle formed by `export … from` (a barrel) IS detected; dynamic `import()` still is not, deliberately, because it is lazy and is usually the fix rather than the fault.',
          suggestion:
            'Break the cycle at its weakest edge: move the shared type or helper into the shared module, or invert one direction with an interface owned by the depended-on side.',
          imperative: 'Do NOT create an import cycle between boundaries',
        },
        'error',
        config,
        constructed,
      ),
    )
  }

  // --- No cross-boundary imports ---
  // Each boundary folder: modules in it can only import from itself + shared
  for (const dir of boundaryFolders) {
    const boundaryPattern = `${dir}/**`
    const allowedGlobs = [boundaryPattern, ...sharedGlobs]

    builders.push(
      ...collectRule(
        modules(p)
          .that()
          .resideInFolder(boundaryPattern)
          .should()
          // Forwarded, like `beFreeOfCycles`. Measured before the fix, a
          // type-only cross-boundary edge failed this rule identically with and
          // without `{ ignoreTypeImports: true }` — the option documented as
          // reaching the isolation rules reached only the cycle rule.
          .onlyImportFromWithOptions(allowedGlobs, options.importOptions ?? {}),
        {
          id: 'preset/boundaries/no-cross-boundary',
          // This rule is folder-level: the allow list is this boundary plus the
          // shared globs, so ANY import from another boundary violates it,
          // whichever file it names. The metadata used to describe
          // entry-point-mediated access — a looser policy the rule does not
          // implement — and its `Fix:` line said "import from the other
          // boundary's entry point instead". Applied exactly, that reproduces
          // the identical violation: measured, `reporting -> billing/index.ts`
          // and `reporting -> billing/internal.ts` fail identically
          // ([bug 0017](../../bugs/fixed/0017-boundaries-no-cross-boundary-message-overclaims-entry-point-enforcement.md)).
          // An agent obeying it loops, and its only exits are unsanctioned.
          because:
            'boundaries may only depend on themselves and the shared modules — an import from another boundary couples the two, whichever file it names',
          // COMPUTED, because no fixed string is right in both configurations.
          // `shared` defaults to `[]`, which is legal, and there the "move it
          // into the shared module" clause names somewhere that does not exist:
          // measured, a boundary importing `src/shared/**` with `shared`
          // unconfigured is itself a violation of this rule.
          suggestion:
            sharedGlobs.length > 0
              ? `Move the code both boundaries need into a shared folder (${sharedGlobs.join(', ')}), or remove the dependency on the other boundary.`
              : 'No shared folders are configured — add one to strictBoundaries({ shared }) and move the code both boundaries need there, or remove the dependency on the other boundary.',
          imperative: 'Do NOT import a file outside this boundary or its shared modules',
        },
        'error',
        config,
        constructed,
      ),
    )
  }

  // --- Shared isolation: shared folders don't import from boundaries ---
  builders.push(...applySharedIsolation(p, sharedGlobs, boundaryFolders, config, constructed))

  // --- Test isolation ---
  if (options.isolateTests) {
    builders.push(...applyTestIsolation(p, boundaryFolders, config, constructed))
  }

  // --- No copy-paste across boundaries ---
  if (options.noCopyPaste) {
    builders.push(
      ...collectRule(
        smells.duplicateBodies(p),
        {
          id: 'preset/boundaries/no-duplicate-bodies',
          because:
            'the same body in two boundaries drifts independently, so a fix applied in one silently leaves the other wrong',
          suggestion:
            'Extract the shared logic into the shared module and call it from both. If the similarity is coincidental, raise withMinSimilarity() or exclude the pair.',
          imperative: 'Do NOT copy a function body across boundaries — extract it into shared',
        },
        'warn',
        config,
        constructed,
      ),
    )
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
