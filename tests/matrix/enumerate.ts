/**
 * The published surface, enumerated from the one list a shipped entry point cannot avoid
 * joining — `package.json`'s `exports` map.
 *
 * Plan 0095. Two consumers with different needs, so two exports:
 *
 *   - `SUBPATHS` is pure data and imports nothing. `tests/core/assertion-gate.test.ts` uses it
 *     and runs in the default suite, which must not depend on a build.
 *   - `loadPublishedExports()` imports from `dist` by package self-reference, so it exercises
 *     the real exports-map resolution rather than bypassing it with relative paths. Only
 *     `tests/matrix/` may call it, and only after a build.
 *
 * Why the exports map and not `src/index.ts`: the root namespace sees none of the eleven
 * subpaths. `assertion-gate.test.ts` used to carry a hand-written `[rootExports, graphqlExports]`
 * pair, which a twelfth subpath would not have joined — and the GraphQL families had already
 * shipped while ADR-009's own first draft called them "scheduled for Phase 3".
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '../..')

/** A `package.json` `exports` entry, as far as this file needs to understand one. */
type ExportsEntry = string | { import?: string | { default?: string }; default?: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The `import` target of one exports-map entry, relative to the repo root. */
function distTarget(entry: unknown): string | undefined {
  if (typeof entry === 'string') return entry
  if (!isRecord(entry)) return undefined
  const imported: unknown = entry.import
  if (typeof imported === 'string') return imported
  if (isRecord(imported) && typeof imported.default === 'string') return imported.default
  if (typeof entry.default === 'string') return entry.default
  return undefined
}

function readExportsMap(): { subpath: string; dist: string }[] {
  const raw: unknown = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  if (!isRecord(raw) || !isRecord(raw.exports)) throw new Error('package.json has no exports map')
  const out: { subpath: string; dist: string }[] = []
  for (const [subpath, entry] of Object.entries(raw.exports)) {
    if (subpath === './package.json') continue
    const dist = distTarget(entry)
    if (dist === undefined) throw new Error(`exports["${subpath}"] has no import target`)
    out.push({ subpath, dist })
  }
  return out
}

/**
 * Every published subpath. Derived, never listed — a new entry point joins by being published,
 * which is the only act a published entry point cannot skip.
 */
export const SUBPATHS: readonly { subpath: string; dist: string }[] = readExportsMap()

/** One exported binding, keyed the way the classification keys it. */
export interface PublishedExport {
  /** `<subpath>:<name>`, e.g. `.:classes` or `.:smells.duplicateBodies`. */
  key: string
  subpath: string
  name: string
  value: unknown
}

/**
 * Load every published export from `dist`, recursing one level into namespace objects.
 *
 * The recursion is not a nicety: `smells` is the export, and `smells.duplicateBodies` is the
 * check. A new member added to an existing namespace — a `smells.godObject()` — adds no
 * top-level export, so a top-level-only enumeration would never see the family bug 0066 is
 * filed against growing a sibling.
 *
 * Requires a current build. `tests/matrix/` is excluded from the default vitest include for
 * exactly this reason; see `npm run test:matrix`.
 */
export async function loadPublishedExports(): Promise<PublishedExport[]> {
  const found: PublishedExport[] = []
  for (const { subpath, dist } of SUBPATHS) {
    // Self-reference, so the exports map itself is under test rather than bypassed.
    const specifier =
      subpath === '.' ? '@nielspeter/ts-archunit' : `@nielspeter/ts-archunit/${subpath.slice(2)}`
    const loaded: unknown = await import(specifier).catch(
      async () => import(path.join(repoRoot, dist)),
    )
    if (!isRecord(loaded)) throw new Error(`${subpath} did not load as a module namespace`)
    for (const [name, value] of Object.entries(loaded)) {
      found.push({ key: `${subpath}:${name}`, subpath, name, value })
      if (isRecord(value)) {
        for (const [member, memberValue] of Object.entries(value)) {
          found.push({
            key: `${subpath}:${name}.${member}`,
            subpath,
            name: `${name}.${member}`,
            value: memberValue,
          })
        }
      }
    }
  }
  return found
}
