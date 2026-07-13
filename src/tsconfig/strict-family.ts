import type { CompilerOptions } from 'ts-morph'

/**
 * The compiler flags that `strict: true` turns on implicitly. tsc resolves each
 * of these via `getStrictOptionValue` — `getCompilerOptions()` returns them
 * UNSET when only `strict` is present, so the rule must mirror that resolution.
 *
 * NOTE: this list is a manual mirror of tsc's strict family and must be updated
 * when TypeScript adds a strict-governed flag. Pinned to TypeScript ~5.9
 * (`strictBuiltinIteratorReturn` added in 5.6). The `satisfies` check below fails
 * to compile if a name here is not a real `CompilerOptions` key, and the
 * `strict-family.test.ts` guard asserts the count so a TS bump surfaces the gap.
 */
const STRICT_FAMILY = [
  'alwaysStrict',
  'noImplicitAny',
  'noImplicitThis',
  'strictBindCallApply',
  'strictBuiltinIteratorReturn',
  'strictFunctionTypes',
  'strictNullChecks',
  'strictPropertyInitialization',
  'useUnknownInCatchVariables',
] as const satisfies ReadonlyArray<keyof CompilerOptions>

export type StrictFamilyFlag = (typeof STRICT_FAMILY)[number]

const STRICT_FAMILY_SET: ReadonlySet<string> = new Set(STRICT_FAMILY)

/** How many flags the strict family governs. Guarded by a test against TS drift. */
export const STRICT_FAMILY_SIZE = STRICT_FAMILY.length

export function isStrictFamily(key: string): key is StrictFamilyFlag {
  return STRICT_FAMILY_SET.has(key)
}

/**
 * Mirror of tsc's `getStrictOptionValue` for the strict family.
 *
 * The effective value of a strict-family flag is:
 *   1. its explicit value, if set (true or false); otherwise
 *   2. the value of `strict`, if set; otherwise
 *   3. `false` (the TypeScript default before `strict`).
 */
export function resolveFlag(opts: CompilerOptions, flag: StrictFamilyFlag): boolean {
  const explicit = opts[flag]
  if (explicit !== undefined) return Boolean(explicit)
  return Boolean(opts.strict)
}
