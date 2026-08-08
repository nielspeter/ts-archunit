import type { RuleDescription } from '../core/rule-description.js'
import type { CollectResult } from '../core/terminal-builder.js'
import { Node } from 'ts-morph'
import { selectionMemo } from '../core/selection-memo.js'
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
const sidesOf = selectionMemo<Map<string, unknown[]>>()

export class CorrespondenceBuilder extends TerminalBuilder {
  private _sides: Side[] = []
  private _checkComplete = false
  private _checkNoOrphans = false
  private _expectEmptySides = new Set<string>()
  private _distinctKeys = new Set<string>()

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
    const next = this.copy()
    if (source instanceof RuleBuilder) {
      if (!keyFn) {
        throw new TypeError(
          `correspondence side '${name}' from a selection requires a keyFn (subject -> key).`,
        )
      }
      next._sides.push({ name, materialize: () => keyedFromSelection(source, keyFn) })
    } else {
      next._sides.push({ name, materialize: () => keyedFromKeys(source) })
    }
    return next
  }

  /**
   * An independent copy, carrying the sides and both opt-out sets.
   *
   * `collectViolations` throws unless there are exactly two sides, so a leaked
   * `_sides` push does not fail silently here — but a leaked declaration does:
   * it is what stands between a vacuous side and a finding, and inheriting it
   * turns a later rule's empty side green.
   */
  protected override copy(): this {
    const clone = super.copy()
    clone._sides = [...this._sides]
    clone._expectEmptySides = new Set(this._expectEmptySides)
    clone._distinctKeys = new Set(this._distinctKeys)
    return clone
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
    const next = this.copy()
    next._checkComplete = true
    return next
  }
  /** Every key of the second side must have a source in the first (B ⊆ A). */
  haveNoOrphans(): this {
    const next = this.copy()
    next._checkNoOrphans = true
    return next
  }
  /** Both directions — the two key sets must be identical. */
  beBijective(): this {
    const next = this.copy()
    next._checkComplete = true
    next._checkNoOrphans = true
    return next
  }

  /**
   * Declare that a NAMED side is empty — plan 0097, replacing `allowEmpty()`.
   *
   * The difference is the whole point, and it is not a rename. `allowEmpty()`
   * PERMITTED a side to be empty and never spoke again: a permanent, silent
   * opt-out that stayed green the day the side filled up and the rule started
   * certifying nothing about it. This ASSERTS the side is empty, and fails the
   * day it stops being — an intent that expires and reports itself, which is
   * the property ADR-009 part 3 requires of every declaration. Plan 0069's
   * appendix rejected the permanent form for the rule family with receipts; a
   * sibling family had it shipped and documented.
   *
   * **The zero-argument form throws here**, and that is the correction of a
   * defect this method shipped with. The parameter has to be optional — a
   * required one is not a valid override of `TerminalBuilder`'s zero-arg
   * `expectEmpty()` — but the OVERRIDE VALIDITY argument justifies the
   * signature, not the semantics. Inheriting the base meaning gave
   * `correspondence().expectEmpty()` a whole-rule flag that suppressed the
   * empty-side finding for BOTH sides and that the expiry branch never read:
   * `allowEmpty` restored, permanent and silent, in fewer characters than
   * before, on the release that deleted it. Measured green over two populated
   * sides, forever.
   *
   * A correspondence compares two named sides, so "this rule is empty" has no
   * meaning that is not per-side. Refusing at build time is the same answer
   * this class already gives a contradiction, and it is loud where the
   * inherited semantics were silent.
   */
  override expectEmpty(side?: string): this {
    if (side === undefined) {
      throw new TypeError(
        'correspondence() declares emptiness per side: call .expectEmpty(sideName) for each side ' +
          'you expect to be empty. A correspondence compares two named sides, so a whole-rule ' +
          'declaration would suppress both and expire on neither.',
      )
    }
    const next = this.copy()
    next._expectEmptySides.add(side)
    return next
  }

  /**
   * Both sides, materialized once — plan 0096, and the ONE method both readers
   * call.
   *
   * Correspondence has no corpus of its own: its sides ARE its input, so the
   * examined unit is their keys and the "selection" is the materialization
   * itself. Sharing it matters more here than anywhere else, because
   * `Side.materialize` is a bare closure over a user-supplied `keyFn` and a full
   * rule selection — so a second derivation would re-run arbitrary user code,
   * and `diagnose()` calling the accessor before `check()` would pay for the
   * whole thing twice.
   */
  private materializedSides(a: Side, b: Side): [Map<string, unknown[]>, Map<string, unknown[]>] {
    // `!` rather than a `?? new Map()` fallback: the compute always returns two
    // entries, so the fallback could never fire — and a branch that cannot fire
    // is the shape this whole programme is about, even when it is only types.
    const pair = sidesOf(this, () => [a.materialize(), b.materialize()])
    return [pair[0]!, pair[1]!]
  }

  /**
   * Units this rule examined — plan 0096: the keys of both sides, summed.
   *
   * Zero means the comparison had nothing to compare, which for this family is
   * two empty sides. One empty side is already its own finding and is not this
   * question.
   */

  /**
   * This family counts keys — the keys of both sides, summed.
   *
   * Plan 0099: `CollectResult.examined` is unit-typed per family (ADR-009 part
   * 1), and the zero-examined message prints the noun. Inheriting the base
   * `'subjects'` is a category error in a sentence whose whole job is naming what
   * was and was not looked at.
   */
  protected override examinedUnitNoun(): string {
    return 'keys'
  }

  examinedUnits(): number {
    if (this._sides.length < 2) return 0
    const [a, b] = this.materializedSides(this._sides[0]!, this._sides[1]!)
    return a.size + b.size
  }

  /**
   * Declared when EVERY side is — plan 0097.
   *
   * The base implementation reads the whole-rule flag, which this class refuses
   * to let anyone set. Without this override, 0098's floor would red a rule
   * whose every side the author declared, with a finding telling them to
   * declare. The per-side loop in `collectViolations` does not need this — its
   * membership test covers each side directly — which is exactly why the
   * previous private version was dead code and was removed. This one is for
   * the root, which asks the question about the rule rather than about a side.
   *
   * **This was recorded as unobservable-until-0098, and that equivalence EXPIRED**
   * the moment plan 0096 made `diagnose()` its first reader. Reverting this
   * override to the base body — which for this class can never be true, since the
   * zero-arg `expectEmpty()` throws — makes a rule whose every side is declared
   * report `zero-subjects` again, telling the author to declare what they
   * declared. A recorded equivalence is a claim with a lifetime, and this one's
   * ended one commit after it was written; it is guarded now.
   */
  override emptyDeclarationAdvice(): string {
    return '.expectEmpty(sideName) for each side'
  }

  override declaresEmpty(): boolean {
    return this._sides.length > 0 && this._sides.every((s) => this._expectEmptySides.has(s.name))
  }

  /** Fail if a side maps two distinct subjects to one key (over-normalization guard). */
  distinctKeysOn(sideName: string): this {
    const next = this.copy()
    next._distinctKeys.add(sideName)
    return next
  }

  /**
   * Wrong arity counts as asserting nothing, **whatever assertion was chosen**.
   *
   * `.beComplete()` on a one-sided correspondence cannot assert anything: there
   * is no second side to compare against, so the call is a claim about a
   * comparison that does not exist. Reading only the assertion flags let that
   * pair through the gate and into `collectViolations()`, where the arity check
   * throws a `RangeError` — and until bug 0025 that error escaped the CLI and
   * dropped every remaining rule file's findings.
   *
   * So the same fault now reports the same way whether or not an assertion was
   * chosen, and `assertionAdvice()` below already names the right remedy for it
   * (another `.side(...)`, never `.beComplete()`). The arity throw stays as an
   * invariant on `collectViolations()`, unreachable through the terminals.
   */
  override assertsSomething(): boolean {
    return this._sides.length === 2 && (this._checkComplete || this._checkNoOrphans)
  }

  override assertionAdvice(): string {
    // Two distinct faults reach here, and naming the wrong one is the ADR-008
    // rule 2 defect this plan is partly about: with fewer than two sides the
    // fix is another `.side(...)`, not an assertion — adding `.beComplete()`
    // would leave the rule exactly as broken (measured in review).
    if (this._sides.length !== 2) {
      return (
        `this correspondence has ${String(this._sides.length)} side(s) and needs exactly two, ` +
        'so it compares nothing. Add the missing .side(name, ...) call.'
      )
    }
    return 'this correspondence asserts nothing: call .beComplete(), .haveNoOrphans(), or .beBijective().'
  }

  /** Named by id or by its sides, not 'unnamed' (plan 0070 §4). */
  override describeRule(): RuleDescription {
    const sides = this._sides.map((side) => side.name).join(' <-> ')
    return {
      ...super.describeRule(),
      rule: this._metadata?.id ?? (sides ? `correspondence [${sides}]` : 'correspondence'),
    }
  }

  protected collectViolations(): CollectResult {
    // Unreachable through `.check()` / `.warn()` / `.violations()` as of the
    // bug-0025 fix: `assertsSomething()` above is false for wrong arity, so the
    // gate reports it as a configuration finding before this method is called.
    // Kept as the invariant it always was — this method indexes `_sides[0]` and
    // `_sides[1]` non-null below, and a direct subclass caller deserves the
    // named error rather than an undefined read. Do not treat it as the answer
    // to "what happens with the wrong number of sides": the loud answer is the
    // gate, and if this ever throws again through a terminal, the gate is gone.
    if (this._sides.length !== 2) {
      throw new RangeError(
        `correspondence() requires exactly two .side(...) calls; got ${String(this._sides.length)}.`,
      )
    }
    // No missing-assertion throw here: the assertion gate reports it as a
    // configuration finding before `collectViolations()` runs (bug 0019), which
    // is why the gate is placed ahead of this method — a `RangeError` from here
    // escaped the CLI's `ArchRuleError`-only catch and dropped every remaining
    // rule file. The sides-count check below stays: wrong arity is a different
    // fault from a missing assertion, and its remedy is another `.side(...)`.

    const sideA = this._sides[0]!
    const sideB = this._sides[1]!

    const meta: ViolationMeta = {
      rule: `correspondence [${sideA.name} <-> ${sideB.name}]`,
      because: this._reason,
      ruleId: this._metadata?.id,
      suggestion: this._metadata?.suggestion,
      docs: this._metadata?.docs,
    }

    // A declaration that binds to no side is a configuration finding, not a
    // no-op — plan 0097, correcting the same defect the shipped version had.
    // `.expectEmpty('servcies')` was accepted silently and asserted nothing
    // forever: the exact hazard this method's own docstring rejects the
    // permanent form for ("one word, silent forever, TYPO OR NOT, and nothing
    // revisits it"), inherited whole by the replacement.
    //
    // ADR-009 part 3 already ruled the structurally identical preset case — a
    // declaration binding to no constructed rule is a FAILING finding, never a
    // warning — so this follows settled precedent rather than deciding anew.
    //
    // Here rather than in the setter: `.expectEmpty(name)` may legally precede
    // `.side(name, …)`, so the setter cannot know yet.
    // A Set, not a concatenation: a name in BOTH sets produced two findings with
    // identical element, message, file and line — the identity shape bugs 0064,
    // 0065 and 0067 were filed for. And membership by the side LIST rather than
    // two name comparisons, so it cannot rot if arity ever changes.
    const declaredNames = new Set([...this._expectEmptySides, ...this._distinctKeys])
    const unbound = [...declaredNames].filter((n) => !this._sides.some((side) => side.name === n))
    if (unbound.length > 0) {
      // A configuration fault: the sides were never materialized, so nothing was
      // examined. Plan 0098 — 0 here is the honest number, not a placeholder.
      return {
        violations: unbound.map((name) =>
          this.unboundSideViolation(name, meta, [sideA.name, sideB.name]),
        ),
        examined: 0,
      }
    }

    const [aKeyed, bKeyed] = this.materializedSides(sideA, sideB)

    const result = setCorrespondence(aKeyed.keys(), bKeyed.keys())

    // Non-vacuity (ADR-008 / proposal 014): an empty side certifies nothing, so
    // it is the root cause — report it and skip the derived coverage flood.
    // TWO lists, because only one of them makes the comparison meaningless.
    //
    // An empty side genuinely certifies nothing, so it is the root cause and the
    // derived coverage flood is noise — that short-circuit stays.
    //
    // A side DECLARED empty that turned out full is the opposite: both sides have
    // content, so the correspondence is perfectly computable and its findings are
    // the ones the reader must act on. Returning here discarded them. Measured on
    // a two-key side A against a one-key side B: 2 real
    // `has no matching b` violations became 0 the moment side B was declared
    // empty, leaving only the config finding. Same defect as
    // `RuleBuilder.evaluate` (fixed alongside this) — and fixing that family
    // alone would have been the "covers the families someone remembered" shape
    // ADR-009 exists to name.
    const emptyFindings: ArchViolation[] = []
    const falseDeclarations: ArchViolation[] = []
    for (const [side, isEmpty] of [
      [sideA, result.aEmpty],
      [sideB, result.bEmpty],
    ] as const) {
      // Per-side only. A `declaresEmpty()` helper stood here with an
      // `_expectEmpty || every(side => declared)` body; the `every` half was
      // unreachable — if every side is in the set then `has(side.name)` is
      // already true for the side under test — and three reviewers deleted it
      // against the full suite with nothing failing. Its stated rationale
      // ("without the OR a user who declared both sides still redded") was a
      // property the code never had.
      const sideDeclared = this._expectEmptySides.has(side.name)
      if (isEmpty && !sideDeclared) {
        emptyFindings.push(this.emptyViolation(side.name, meta))
      }
      // The expiry half, and the reason this is an assertion rather than a
      // permission: a declared-empty side that filled up is the intent
      // reporting itself, where `allowEmpty()` stayed silent forever.
      if (!isEmpty && this._expectEmptySides.has(side.name)) {
        falseDeclarations.push(this.unexpectedlyNonEmptyViolation(side.name, meta))
      }
    }
    // Only a genuinely empty side stops the comparison.
    if (emptyFindings.length > 0)
      return {
        violations: [...emptyFindings, ...falseDeclarations],
        examined: this.examinedUnits(),
      }

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

    // The false declaration FIRST — it says the configuration is wrong, which the
    // reader needs before the findings produced under it, matching the ordering
    // `RuleBuilder.evaluate` and the preset config findings already use.
    return { violations: [...falseDeclarations, ...violations], examined: this.examinedUnits() }
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

  /**
   * A declaration names a side this rule does not have — plan 0097.
   *
   * Covers `.expectEmpty(name)` and `.distinctKeysOn(name)` alike, because both
   * are membership tests against side names and both were silent on a typo. The
   * remedy is mechanical and names the sides that DO exist, so the reader does
   * not have to go and look.
   */
  private unboundSideViolation(
    name: string,
    meta: ViolationMeta,
    actual: readonly string[],
  ): ArchViolation {
    const known = actual.map((s) => `'${s}'`).join(' and ')
    return {
      ...this.baseViolation(
        name,
        '',
        0,
        `this rule declares something about a side named '${name}', but its sides are ${known} — ` +
          `so the declaration binds to nothing and asserts nothing.`,
        {
          rule: `correspondence [${actual.join(' <-> ')}]`,
          because: this._reason,
          ruleId: this._metadata?.id,
        },
      ),
      suggestion: `Correct the side name to one of ${known}, or remove the declaration.`,
      docs: undefined,
      bypassFilters: true,
    }
  }

  /**
   * The declared side filled up — plan 0097.
   *
   * This finding is why `.expectEmpty(side)` replaced `allowEmpty(side)`: the
   * permission had no failing state, so a side that gained keys silently kept a
   * rule green that was certifying nothing about them. An assertion that expires
   * reports itself; a permission never does.
   *
   * Its remedy is mechanical and is the one ADR-008 rule 2 asks be verified:
   * remove the declaration, and the finding clears.
   */
  private unexpectedlyNonEmptyViolation(sideName: string, meta: ViolationMeta): ArchViolation {
    return {
      ...this.baseViolation(
        sideName,
        '',
        0,
        `correspondence side '${sideName}' was declared empty with .expectEmpty('${sideName}'), ` +
          `and now matches subjects — so the declaration no longer describes this rule.`,
        meta,
      ),
      suggestion:
        `Remove .expectEmpty('${sideName}') so the side is compared like any other, or narrow ` +
        `the '${sideName}' selector if it was meant to stay empty.`,
      docs: undefined,
      bypassFilters: true,
    }
  }

  private emptyViolation(sideName: string, meta: ViolationMeta): ArchViolation {
    return {
      ...this.baseViolation(
        sideName,
        '',
        0,
        `correspondence side '${sideName}' matched 0 subjects — a correspondence over an ` +
          `empty side certifies nothing. Fix the selector, or call .expectEmpty('${sideName}') ` +
          `if an empty side is valid here.`,
        meta,
      ),
      // Its own remedy, overriding what `baseViolation` copied from the rule's
      // metadata (bug 0021). `baseViolation` is shared with real violations, where
      // inheriting the author's `suggestion` is correct — so the override has to be
      // here, and the guard in `execute-rule.ts` cannot reach it.
      suggestion:
        `Fix the '${sideName}' selector so it matches at least one subject, or call ` +
        `.expectEmpty('${sideName}') if an empty side is the point — that asserts it, and fails the day the side fills up.`,
      docs: undefined,
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
  if (
    (first === '"' || first === "'" || first === '`') &&
    text.length >= 2 &&
    text.endsWith(first)
  ) {
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
