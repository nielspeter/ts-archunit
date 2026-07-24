import { Node } from 'ts-morph'
import type { ArchProject } from '../core/project.js'
import type { ArchViolation } from '../core/violation.js'
import { getElementName, getElementFile, getElementLine } from '../core/violation.js'
import { RuleBuilder } from '../core/rule-builder.js'
import { TerminalBuilder } from '../core/terminal-builder.js'
import { setCorrespondence } from '../core/correspondence-core.js'

/**
 * Map a selection subject to one or more comparison keys.
 *
 * This is the acknowledged raw-node seam (ADR-007): `subject` is the builder's
 * element type (a ts-morph node for `classes()`/`types()`, an `ArchCall` /
 * `ArchFunction` wrapper otherwise). Prefer the `byName` / `byArg` /
 * `byPropertyNames` vocabulary below for the common cases.
 */
export type KeyFn<T> = (subject: T) => string | readonly string[]

/** A plain, already-derived key set. Normalize keys before passing them. */
export type KeysSource = readonly string[] | ReadonlySet<string>

interface ViolationMeta {
  readonly rule: string
  readonly because?: string
  readonly ruleId?: string
  readonly suggestion?: string
  readonly docs?: string
}

interface Side {
  readonly name: string
  /** Lazily build key → subjects (subjects is empty for a literal side). */
  readonly materialize: () => Map<string, unknown[]>
}

function toKeyArray(key: string | readonly string[]): readonly string[] {
  return typeof key === 'string' ? [key] : key
}

/** Model wrappers (ArchCall, ArchFunction, …) expose getNode(): Node. */
interface NodeBearer {
  getNode(): Node
}

function isNodeBearer(value: unknown): value is NodeBearer {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getNode' in value &&
    typeof value.getNode === 'function'
  )
}

/** Resolve a subject to a ts-morph node for file:line, or undefined if it carries none. */
function toNode(subject: unknown): Node | undefined {
  if (Node.isNode(subject)) return subject
  if (isNodeBearer(subject)) {
    const node = subject.getNode()
    if (Node.isNode(node)) return node
  }
  return undefined
}

function keyedFromSelection<T>(source: RuleBuilder<T>, keyFn: KeyFn<T>): Map<string, unknown[]> {
  const map = new Map<string, unknown[]>()
  for (const subject of source.subjects()) {
    for (const key of toKeyArray(keyFn(subject))) {
      const bucket = map.get(key)
      if (bucket) bucket.push(subject)
      else map.set(key, [subject])
    }
  }
  return map
}

function keyedFromKeys(keys: KeysSource): Map<string, unknown[]> {
  const map = new Map<string, unknown[]>()
  for (const key of keys) {
    if (!map.has(key)) map.set(key, [])
  }
  return map
}

/**
 * Assert a correspondence between two independently-derived key sets:
 * "every X has a matching Y" (and/or the reverse). This is ADR-008 Rule 5 as a
 * primitive — two derivations plus a disagreement test — so identity-not-count
 * and non-vacuity are impossible to get wrong.
 *
 * The chain: `.side()` twice → `.beComplete()` / `.haveNoOrphans()` /
 * `.beBijective()` → `.check()`.
 *
 * @example
 * correspondence(p)
 *   .side('routes', calls(p).that().onObject('app'), byArg(0))
 *   .side('matrix', Object.keys(ROUTE_PERMISSIONS))
 *   .should()
 *   .beComplete()
 *   .rule({ id: 'auth/route-matrix', suggestion: 'Add the route to ROUTE_PERMISSIONS.' })
 *   .check()
 */
export class CorrespondenceBuilder extends TerminalBuilder {
  private readonly _sides: Side[] = []
  private _checkComplete = false
  private _checkNoOrphans = false
  private readonly _allowEmpty = new Set<string>()
  private readonly _distinctKeys = new Set<string>()

  // `_project` is accepted for API symmetry with the other entry points
  // (modules/classes/…); correspondence's sides carry their own project.
  constructor(_project: ArchProject) {
    super()
  }

  /** Add a side from a selection, keyed by `keyFn`. */
  side<T>(name: string, source: RuleBuilder<T>, keyFn: KeyFn<T>): this
  /** Add a side from an already-derived key set (pre-normalized). */
  side(name: string, keys: KeysSource): this
  side<T>(name: string, source: RuleBuilder<T> | KeysSource, keyFn?: KeyFn<T>): this {
    if (source instanceof RuleBuilder) {
      if (!keyFn) {
        throw new TypeError(
          `correspondence side '${name}' from a selection requires a keyFn (subject -> key).`,
        )
      }
      this._sides.push({ name, materialize: () => keyedFromSelection(source, keyFn) })
    } else {
      this._sides.push({ name, materialize: () => keyedFromKeys(source) })
    }
    return this
  }

  /** Optional readability markers — the assertion terminals may be called directly. */
  should(): this {
    return this
  }
  andShould(): this {
    return this
  }

  /** Every key of the first side must have a match in the second (A ⊆ B). */
  beComplete(): this {
    this._checkComplete = true
    return this
  }
  /** Every key of the second side must have a source in the first (B ⊆ A). */
  haveNoOrphans(): this {
    this._checkNoOrphans = true
    return this
  }
  /** Both directions — the two key sets must be identical. */
  beBijective(): this {
    this._checkComplete = true
    this._checkNoOrphans = true
    return this
  }

  /** Permit a named side to be empty (opt out of the non-vacuity guard). */
  allowEmpty(sideName: string): this {
    this._allowEmpty.add(sideName)
    return this
  }
  /** Fail if a side maps two distinct subjects to one key (over-normalization guard). */
  distinctKeysOn(sideName: string): this {
    this._distinctKeys.add(sideName)
    return this
  }

  protected collectViolations(): ArchViolation[] {
    if (this._sides.length !== 2) {
      throw new RangeError(
        `correspondence() requires exactly two .side(...) calls; got ${String(this._sides.length)}.`,
      )
    }
    if (!this._checkComplete && !this._checkNoOrphans) {
      throw new RangeError(
        'correspondence() requires an assertion: .beComplete(), .haveNoOrphans(), or .beBijective().',
      )
    }

    const sideA = this._sides[0]!
    const sideB = this._sides[1]!
    const aKeyed = sideA.materialize()
    const bKeyed = sideB.materialize()

    const meta: ViolationMeta = {
      rule: `correspondence [${sideA.name} <-> ${sideB.name}]`,
      because: this._reason,
      ruleId: this._metadata?.id,
      suggestion: this._metadata?.suggestion,
      docs: this._metadata?.docs,
    }

    const result = setCorrespondence(aKeyed.keys(), bKeyed.keys())

    // Non-vacuity (ADR-008 / proposal 014): an empty side certifies nothing, so
    // it is the root cause — report it and skip the derived coverage flood.
    const emptyFindings: ArchViolation[] = []
    if (result.aEmpty && !this._allowEmpty.has(sideA.name)) {
      emptyFindings.push(this.emptyViolation(sideA.name, meta))
    }
    if (result.bEmpty && !this._allowEmpty.has(sideB.name)) {
      emptyFindings.push(this.emptyViolation(sideB.name, meta))
    }
    if (emptyFindings.length > 0) return emptyFindings

    const violations: ArchViolation[] = []

    if (this._checkComplete) {
      for (const key of result.missing) {
        violations.push(
          ...this.keyViolations(
            aKeyed,
            key,
            `${sideA.name} "${key}" has no matching ${sideB.name}`,
            meta,
          ),
        )
      }
    }
    if (this._checkNoOrphans) {
      for (const key of result.orphans) {
        violations.push(
          ...this.keyViolations(
            bKeyed,
            key,
            `${sideB.name} "${key}" has no matching ${sideA.name}`,
            meta,
          ),
        )
      }
    }

    // Over-normalization guard (opt-in): one key from many subjects can mask a
    // real "two subjects, one counterpart" mismatch.
    for (const side of [sideA, sideB] as const) {
      if (!this._distinctKeys.has(side.name)) continue
      const keyed = side === sideA ? aKeyed : bKeyed
      for (const [key, subjects] of keyed) {
        if (subjects.length > 1) {
          violations.push(
            ...this.keyViolations(
              keyed,
              key,
              `${side.name} maps ${String(subjects.length)} distinct subjects to the key "${key}" — over-normalization can mask a real mismatch`,
              meta,
            ),
          )
        }
      }
    }

    // NOTE: independence of the two sides is a *requirement* stated in the docs,
    // not something the builder can mechanically enforce — two literal lists can
    // be legitimately independent (e.g. Object.keys of two different runtime
    // objects), so a "both sides literal" heuristic would false-positive, and a
    // console.warn is invisible to the agent consumer (ADR-008). Left to review.

    return violations
  }

  private keyViolations(
    keyed: Map<string, unknown[]>,
    key: string,
    message: string,
    meta: ViolationMeta,
  ): ArchViolation[] {
    const subjects = keyed.get(key) ?? []
    if (subjects.length === 0) {
      // Plain-key side — no source location available.
      return [this.baseViolation(key, '', 0, message, meta)]
    }
    return subjects.map((subject) => {
      const node = toNode(subject)
      if (node) {
        return this.baseViolation(
          getElementName(node),
          getElementFile(node),
          getElementLine(node),
          message,
          meta,
        )
      }
      return this.baseViolation(key, '', 0, message, meta)
    })
  }

  private emptyViolation(sideName: string, meta: ViolationMeta): ArchViolation {
    return {
      ...this.baseViolation(
        sideName,
        '',
        0,
        `correspondence side '${sideName}' matched 0 subjects — a correspondence over an ` +
          `empty side certifies nothing. Fix the selector, or call .allowEmpty('${sideName}') ` +
          `if an empty side is valid here.`,
        meta,
      ),
      // Config-level meta-finding: no source file to attribute to, so it must
      // survive diff-aware/baseline or the guard re-greens under standard CI.
      bypassFilters: true,
    }
  }

  private baseViolation(
    element: string,
    file: string,
    line: number,
    message: string,
    meta: ViolationMeta,
  ): ArchViolation {
    return {
      rule: meta.rule,
      ruleId: meta.ruleId,
      element,
      file,
      line,
      message,
      because: meta.because,
      suggestion: meta.suggestion,
      docs: meta.docs,
    }
  }
}

/**
 * Entry point: assert a correspondence between two independently-derived key
 * sets. Call `.side(...)` twice, then an assertion terminal.
 */
export function correspondence(p: ArchProject): CorrespondenceBuilder {
  return new CorrespondenceBuilder(p)
}

// --- keyFn vocabulary (the common cases; keyFn stays a raw escape hatch) ---

/** Key a subject by its name (`getName()`); anonymous subjects fall back to `<anonymous>`. */
export function byName<T extends { getName(): string | undefined }>(): KeyFn<T> {
  return (subject) => subject.getName() ?? '<anonymous>'
}

/**
 * Key a call-like subject by its argument at `index`. String/template literal
 * arguments are unquoted so keys match plain sides (e.g. `Object.keys(map)`) —
 * `app.get("/x", …)` keys as `/x`, not `"/x"`. Non-literal args key by raw text.
 */
export function byArg<T extends { getArguments(): { getText(): string }[] }>(
  index: number,
): KeyFn<T> {
  return (subject) => {
    const arg = subject.getArguments()[index]
    return arg ? unquote(arg.getText()) : '<no-arg>'
  }
}

/** Strip a single pair of matching surrounding quotes/backticks, if present. */
function unquote(text: string): string {
  const first = text[0]
  if ((first === '"' || first === "'" || first === '`') && text.length >= 2 && text.endsWith(first)) {
    return text.slice(1, -1)
  }
  return text
}

/** Key a type-like subject by each of its property names (one subject → many keys). */
export function byPropertyNames<
  T extends { getProperties(): { getName(): string }[] },
>(): KeyFn<T> {
  return (subject) => subject.getProperties().map((property) => property.getName())
}
