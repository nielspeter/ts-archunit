import { ScriptTarget, ModuleKind, ModuleResolutionKind } from 'ts-morph'
import type { CompilerOptions } from 'ts-morph'
import type { ArchProject } from '../core/project.js'
import type { ArchViolation } from '../core/violation.js'
import { TerminalBuilder } from '../core/terminal-builder.js'
import { isStrictFamily, resolveFlag } from './strict-family.js'

const RULE_DESCRIPTION = 'tsconfig compiler options must satisfy requirements'

/**
 * Asserts that a project's resolved TypeScript compiler options match a
 * user-supplied spec. A non-iterating rule (one project → one options object),
 * so it extends {@link TerminalBuilder} like the smell detectors rather than the
 * element-builder DSL. One violation is emitted per mismatched flag; the flag
 * name is the violation `element`, so `.excluding('strictNullChecks')` filters
 * by flag.
 */
export class TsconfigBuilder extends TerminalBuilder {
  private _requirements: Partial<CompilerOptions> = {}

  constructor(private readonly project: ArchProject) {
    super()
  }

  /**
   * Merge a partial compiler-options spec into the requirements for this rule.
   * Each present key must equal the project's resolved value (strict-family
   * flags are resolved through `strict: true` the way tsc resolves them).
   * Multiple `.requires()` calls merge additively; later keys win on conflict.
   */
  requires(spec: Partial<CompilerOptions>): this {
    this._requirements = { ...this._requirements, ...spec }
    return this
  }

  protected collectViolations(): ArchViolation[] {
    const opts = this.project._project.getCompilerOptions()
    const file = this.project.tsConfigPath
    const violations: ArchViolation[] = []

    for (const key of Object.keys(this._requirements)) {
      const expected = this._requirements[key]
      const strictFamily = isStrictFamily(key)
      const actual = strictFamily ? resolveFlag(opts, key) : opts[key]
      if (valuesEqual(expected, actual)) continue

      const expectedText = displayValue(key, expected)
      const actualText = displayValue(key, actual)
      violations.push({
        rule: RULE_DESCRIPTION,
        element: key,
        file,
        line: 1,
        message: `compiler option "${key}": required ${expectedText}, actual ${actualText}`,
        suggestion: fixSuggestion(key, expected, strictFamily),
      })
    }

    return violations
  }
}

/** Human-readable fix hint for a mismatched flag. */
function fixSuggestion(key: string, expected: unknown, strictFamily: boolean): string {
  const base = `Set "${key}": ${jsonValue(expected)} in compilerOptions.`
  return strictFamily && expected === true ? `${base} (or enable "strict".)` : base
}

/** JSON-ish literal for a suggestion, e.g. `true`, `"ES2022"`, `["dom"]`. */
function jsonValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  return JSON.stringify(value)
}

/**
 * Render a compiler-option value for a message. Numeric enum fields
 * (`target`, `module`, `moduleResolution`) are shown by name, not their raw
 * numeric value; unset shows `(unset)`.
 */
function displayValue(key: string, value: unknown): string {
  if (value === undefined) return '(unset)'
  if (typeof value === 'number') return enumName(key, value) ?? String(value)
  if (typeof value === 'boolean' || typeof value === 'bigint') return String(value)
  if (typeof value === 'string') return value
  return JSON.stringify(value) // arrays, objects, null
}

function enumName(key: string, value: number): string | undefined {
  if (key === 'target') return ScriptTarget[value]
  if (key === 'module') return ModuleKind[value]
  if (key === 'moduleResolution') return ModuleResolutionKind[value]
  return undefined
}

/** Structural equality — handles primitives, arrays (order-sensitive), and plain objects. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => valuesEqual(x, b[i]))
  }
  if (isRecord(a) && isRecord(b)) {
    const ak = Object.keys(a)
    const bk = Object.keys(b)
    return ak.length === bk.length && ak.every((k) => valuesEqual(a[k], b[k]))
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
