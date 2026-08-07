import { Node } from 'ts-morph'
import { generateCodeFrame } from './code-frame.js'
import { registerCacheReset } from './cache-registry.js'

/**
 * A single architecture rule violation.
 *
 * Represents one element that failed to satisfy a condition.
 */
export interface ArchViolation {
  /** Human-readable rule description (from the fluent chain) */
  rule: string
  /** Unique rule identifier from .rule({ id }) */
  ruleId?: string
  /** Element identifier, e.g. "OrderService.getTotal()" or "parseConfig" */
  element: string
  /** Absolute file path where the violation occurs */
  file: string
  /** Line number where the violating element starts */
  line: number
  /** Human-readable description of what went wrong */
  message: string
  /**
   * Stable identity for baseline matching, when the rendered message is not a
   * safe identifier.
   *
   * By default a violation is identified by `rule::element::message`, which is
   * right as long as the message says only what is wrong. It breaks when the
   * message also encodes *circumstances*:
   *
   * - a derived population — `"3 of 5 files … use X"` becomes `"4 of 6"` when
   *   an unrelated sibling is added, and every accepted finding in that folder
   *   changes identity;
   * - an ordering — a pairwise detector that reports `A → B` reports `B → A`
   *   when the file walk runs in a different order, which is a property of the
   *   filesystem, not of the code;
   * - a coordinate — `"at line 12"` moves when anything above it is edited.
   *
   * Set this to a canonical form and identity survives all three. It replaces
   * both `element` and `message` in the hash, so it must be unique per finding
   * within a rule: two distinct violations sharing one identity are one
   * violation to the baseline, and accepting either accepts both. Absolute
   * paths inside it are fine — they are normalised away with the rest
   * (`src/core/identity-root.ts`).
   *
   * The rendered output is unaffected; this is identity only.
   */
  identity?: string

  /**
   * The measurement this finding reports, for a metric condition — bug 0012.
   *
   * The baseline stores it and compares rather than equates, so improving a
   * metric stays green while regressing past the accepted value fails. Absent
   * on every non-metric finding, where equality of identity is the right test.
   */
  measured?: number
  /** Optional rationale provided via .because() */
  because?: string
  /** Source code snippet around the violation line */
  codeFrame?: string
  /** Actionable suggestion for fixing the violation (e.g. "Replace parseInt() with this.extractCount()") */
  suggestion?: string
  /** Link to documentation — ADR, wiki, style guide */
  docs?: string
  /** Severity of this violation. Absent means 'error' (the default). */
  severity?: 'error' | 'warn'
  /**
   * When true, this is a meta-finding about rule *configuration* (e.g. an empty
   * selector or empty discovery), not about a source file. It has no changed
   * file to attribute to, so the diff-aware and baseline filters must NOT drop
   * it — otherwise the guard silently re-greens under the standard CI mode
   * (ADR-008; plan 0067).
   */
  bypassFilters?: boolean
}

/**
 * Check if a node is a named declaration and return its name, or undefined.
 * Constructors return "constructor" since they have no getName().
 */
function getNodeName(node: Node): string | undefined {
  if (Node.isConstructorDeclaration(node)) return 'constructor'
  if (
    Node.isClassDeclaration(node) ||
    Node.isFunctionDeclaration(node) ||
    Node.isInterfaceDeclaration(node) ||
    Node.isTypeAliasDeclaration(node) ||
    Node.isEnumDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node) ||
    Node.isPropertyDeclaration(node) ||
    Node.isVariableDeclaration(node)
  ) {
    return node.getName()
  }
  return undefined
}

/**
 * Check if a node is a structural member that should appear in
 * qualified element names (e.g., "ClassName.methodName").
 * Returns the member name, or undefined to skip.
 */
function getStructuralName(node: Node): string | undefined {
  if (Node.isConstructorDeclaration(node)) return 'constructor'
  if (
    Node.isMethodDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node) ||
    Node.isPropertyDeclaration(node)
  ) {
    return node.getName()
  }
  // Arrow/function expressions: check if assigned to a named variable
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    const parent = node.getParent()
    if (parent && Node.isVariableDeclaration(parent)) {
      return parent.getName()
    }
  }
  return undefined
}

/**
 * Check if a node is a top-level architectural boundary where
 * the ancestor walk should stop.
 */
function isTopLevelDeclaration(node: Node): boolean {
  return (
    Node.isClassDeclaration(node) ||
    Node.isInterfaceDeclaration(node) ||
    Node.isTypeAliasDeclaration(node) ||
    Node.isEnumDeclaration(node) ||
    Node.isFunctionDeclaration(node)
  )
}

/**
 * Extract a human-readable name from a ts-morph Node.
 *
 * If the node itself is a named declaration (class, function, method, etc.),
 * returns its name directly. Otherwise, walks up the AST ancestors to find
 * the nearest named declaration and builds a qualified name like
 * "ClassName.methodName". This ensures that inner nodes (e.g., AsExpression,
 * CallExpression) produce meaningful element names for `.excluding()` matching.
 *
 * Falls back to the node's kind name only if no named ancestor is found
 * (e.g., top-level expressions in a module).
 */
/**
 * Force a configuration meta-finding to `error`, whatever the rule asked for.
 *
 * A `bypassFilters` finding reports that the rule enforces **nothing**. That is
 * not a violation the author gets to grade: `.asSeverity('warn')` says "these
 * violations are advisory", and a rule that cannot fire has no violations to
 * be advisory about. Under ADR-008 rule 1 an actionable finding must fail, and
 * the other suppression paths already refuse to silence these — `.excluding()`
 * refuses explicitly, baseline and diff honour the flag. The full roster is
 * `UNSUPPRESSABLE_MECHANISMS` in `unsuppressable.ts`, which is also what the
 * user-facing sentence is built from; it has grown twice, so it is named here
 * rather than counted. (This paragraph said "three of the four" while the list
 * stood at six.)
 *
 * Applied at all three severity-stamping sites. `stampSeverity` alone is not
 * enough: `.violations()` inlines its own map in both root builders, and the
 * `executeWarn` path resolves an unset severity to `warn`, which is where most
 * producers landed.
 */
export function severityFor(
  violation: ArchViolation,
  fallback: 'error' | 'warn',
): 'error' | 'warn' {
  return violation.bypassFilters === true ? 'error' : fallback
}

/**
 * True when a violation's remedy **is** its message, so a renderer that has
 * already shown the message must not append a `Fix:` line repeating it.
 *
 * The assertion gate's finding reports that a rule cannot fire; there, the fault
 * and its remedy are one sentence, and both fields carry that sentence on
 * purpose — the JSON payload reads `suggestion`, a human reads the body, and a
 * configuration finding is the one kind that cannot fall back to the author's
 * `suggestion` (`execute-rule.ts` refuses it, bug 0021). Measured before the
 * fix: every surface printed the same paragraph twice.
 *
 * One definition, because the three renderers must not disagree about it.
 * Whether a given renderer *did* render the message stays renderer-local: the
 * rich terminal format shows it only for a location-less finding, while the
 * plain and GitHub formats always do.
 */
export function remedyRepeatsMessage(violation: ArchViolation): boolean {
  return violation.suggestion !== undefined && violation.suggestion === violation.message
}

export function getElementName(node: Node): string {
  const directName = getNodeName(node)
  if (directName !== undefined) return directName
  return enclosingScopeName(node) ?? node.getKindName()
}

/**
 * The structural name of the nearest ENCLOSING declaration — always an ancestor
 * walk, never the node's own name.
 *
 * Split out of `getElementName`, which returns the node's own name when it has
 * one and only walks ancestors otherwise. That difference is invisible until
 * something needs "what encloses this?" rather than "what is this called?", and
 * then it is a defect: a metric identity built on `getElementName` as if it were
 * a scope left method-shorthand object-literal functions (`{ build() {} }`)
 * unqualified, because a `MethodDeclaration` has its own name — so two factories
 * each returning `{ build() {} }` shared one identity while the arrow spelling
 * of the same code did not.
 *
 * Returns `undefined` when no named declaration encloses the node, which is a
 * real answer — a literal passed as a call argument at module level has no scope
 * — and not a value to substitute a kind name for.
 */
export function enclosingScopeName(node: Node): string | undefined {
  // Walk up ancestors collecting structural names: method/constructor/accessor
  // at the member level, class/function at the top level. Skips variables,
  // properties, and expressions — those are implementation detail.
  const parts: string[] = []
  let current: Node | undefined = node.getParent()
  while (current) {
    // Top-level declarations: collect name and stop
    if (isTopLevelDeclaration(current)) {
      const name = getNodeName(current)
      if (name !== undefined) parts.unshift(name)
      break
    }
    // Structural members: collect name and keep walking to find the parent class
    const memberName = getStructuralName(current)
    if (memberName !== undefined) {
      parts.unshift(memberName)
    }
    current = current.getParent()
  }

  return parts.length > 0 ? parts.join('.') : undefined
}

/**
 * Get the absolute file path for a ts-morph Node.
 */
export function getElementFile(node: Node): string {
  return node.getSourceFile().getFilePath()
}

/**
 * Get the start line number for a ts-morph Node.
 */
export function getElementLine(node: Node): number {
  return node.getStartLineNumber()
}

/**
 * Create an ArchViolation from a ts-morph Node and context.
 *
 * Convenience function used by all condition implementations to produce
 * consistent violation objects.
 */
export function createViolation(
  node: Node,
  message: string,
  context: {
    rule: string
    because?: string
    suggestion?: string
    ruleId?: string
    docs?: string
  },
): ArchViolation {
  const line = getElementLine(node)
  const sourceText = node.getSourceFile().getFullText()
  return {
    rule: context.rule,
    ruleId: context.ruleId,
    element: getElementName(node),
    file: getElementFile(node),
    line,
    message,
    because: context.because,
    suggestion: context.suggestion,
    docs: context.docs,
    codeFrame: generateCodeFrame(sourceText, line),
  }
}

/**
 * Unicode codepoint order — the only comparator admissible anywhere a baseline identity, an
 * `element`, or a reported location is derived from a sort.
 *
 * `String.prototype.localeCompare` without an explicit locale reads the **host** locale from
 * `LANG`/`LC_ALL`, so a value sorted with it differs between a developer's machine and CI.
 * Measured on plain ASCII: `['zebra','aardvark']` sorts to `aardvark,zebra` under `en-US` and
 * to `zebra,aardvark` under `da-DK`, because Danish collates `aa` as `å`, after `z`. One
 * finding, two baseline hashes, diverging only in the place hardest to debug.
 *
 * The codebase already knew: `module-edges.ts` wrote *"`localeCompare` is ICU/locale sensitive
 * — exactly the machine-dependent ordering `conditions/slice.ts` goes out of its way to
 * eliminate, because a value that differs per machine gives one finding two identities"* — 60
 * lines above a `localeCompare` in the identity discriminator, while `conditions/slice.ts`
 * eliminated its own machine-dependence *using `localeCompare`*. Four sites in all.
 *
 * `tests/tools/scan-locale-ordering.test.ts` is what keeps that from recurring: a runtime row
 * cannot catch it, because on an `en-US` machine both comparators agree — a guard written for
 * this defect passed 16/16 with the defect reinstated.
 */
export function byCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The subject `hashViolation` keys a baseline entry on: `identity`, or `element::message`.
 *
 * **Exported and consumed by `hashViolation`/`hashSubject`** rather than duplicated. An earlier
 * draft kept a private copy here on the reasoning that `core/` must not depend on `helpers/` —
 * true, but backwards: `helpers/baseline.ts` already imports from `core/`, which is the
 * permitted direction, and `core/identity-root.ts` records the same move for the same reason.
 * A copy plus a test asserting the copies agree is strictly worse than one definition: the
 * test can only compare the formulas over fixtures it happens to build, and the first draft's
 * fixture shared every field, so it agreed under any formula.
 */
export function subjectOf(violation: ArchViolation): string {
  return violation.identity ?? `${violation.element}::${violation.message}`
}

/**
 * The full key `hashViolation` hashes — `rule::subject` — and therefore the unit
 * {@link disambiguateIdentities} must group on.
 *
 * **Grouping on the subject alone was a defect**, measured: `hashViolation` includes `rule`, so
 * two findings carrying the same `element::message` under *different* rule descriptions already
 * hash apart and were never ambiguous. Suffixing the second moved a baseline entry that had no
 * collision — the precise failure this mechanism exists to avoid, committed by the mechanism.
 *
 * Not live at the time it was found (instrumenting the whole suite showed one batch carrying
 * more than one rule string and zero over-suffixed findings), but reachable by construction:
 * several builders mix `metadata?.id ?? description` with a bare `description` inside one batch
 * — `slice-rule-builder.ts`, `correspondence-builder.ts`, `tsconfig-builder.ts`,
 * `inconsistent-siblings.ts`, `schema-rule-builder.ts` all do. Any of them emitting a colliding
 * subject across their two rule strings would have moved a published entry.
 */
function groupKeyOf(violation: ArchViolation): string {
  return `${violation.rule}::${subjectOf(violation)}`
}

/**
 * Give every finding in a rule a distinct identity, by suffixing only the ones that collide.
 *
 * {@link ArchViolation.identity} states the invariant this enforces: *"it must be unique per
 * finding within a rule: two distinct violations sharing one identity are one violation to the
 * baseline, and accepting either accepts both."* That was prose with nothing behind it, and
 * three families broke it independently —
 * [bug 0063](../../bugs/fixed/0063-a-dependency-identity-collides-across-files-sharing-a-basename.md)
 * (dependency), [plan 0088](../../plans/0088-a-slice-finding-identifies-itself.md) (slice), and
 * then [0064](../../bugs/fixed/0064-a-dependency-identity-collides-across-two-spellings-of-one-module.md)
 * and [0065](../../bugs/fixed/0065-reverse-dependency-findings-carry-no-identity.md). Each was fixed
 * per-family, in the family that happened to be reviewed; this is the mechanism, so the next
 * producer cannot reintroduce it.
 *
 * **A finding whose subject is unique is returned untouched — that is a theorem, not a
 * measurement.** Only a subject that appears more than once is altered, and only from its
 * second occurrence onward, so:
 *
 * - no existing baseline entry moves, because a *unique* entry is what a correct baseline holds;
 * - the entry a colliding pair *did* record still matches, because the first occurrence keeps
 *   its subject verbatim — so the fail-open closes by making the hidden sibling report as new,
 *   which is the finding an adopter never got to see.
 *
 * Groups that collide were, by definition, one baseline entry standing for two findings: an
 * entry that was already wrong. Those are the only ones that move.
 *
 * **Ordering — a limitation, not a guarantee.** The suffix follows the order the rule produced
 * its findings, so a baseline entry accepts *a position in a group*, not *a finding*. An earlier
 * draft of this paragraph said the residual "is not a fail-open, because the group still yields
 * as many distinct identities as it has findings", and cited `ModuleEdge.ordinal` as its source.
 * The premise is true and the conclusion does not follow — and that source, which measured the
 * identical residual one layer down, concludes the opposite. Its table, reproduced because it
 * applies verbatim here:
 *
 * | edit to an accepted colliding group       | new reds reported |
 * | ----------------------------------------- | ----------------- |
 * | add a sibling                             | 1 — correct       |
 * | insert a sibling **above** the first        | 1 — correct count |
 * | **delete one, add a different one**       | **0 — silent**    |
 *
 * So the equal-count swap is a **fail-open**: a violation that did not exist when the baseline
 * was written arrives pre-accepted. Strictly better than before this mechanism — where *any*
 * number of added siblings was pre-accepted, not only an equal-count swap — and still a hole.
 *
 * The middle row is right about the number and wrong about the name: the finding reported may
 * be a **sibling nobody touched**, while the newly-added one takes the bare subject and matches
 * the existing entry. For ADR-008's stated primary consumer — an agent that acts on the message
 * — pointing at the wrong file is worse than a miss.
 *
 * Sharper still where an entry carries state: a `measured` metric entry holds an accepted
 * ceiling, so a swap can hand the survivor a ceiling belonging to a different element and
 * silently accept a regression. That is bug 0028's shape recreated inside bug 0012's fix.
 *
 * The durable answer is a real per-finding identity — a `binding` field for the edge family,
 * qualified names for the metric family — tracked in
 * [plan 0094](../../plans/0094-the-residual-findings-from-the-v0-56-0-review.md). This is the
 * floor: a collision can no longer be silent *at scale*. It is not the ceiling.
 *
 * **Why here and not per condition.** `applyFilters` is the one path every terminal shares, and
 * its own contract is that identity is complete before any filter reads it. Running before the
 * filters also makes identity a property of *what the rule found* rather than of what a
 * `--changed` or `.excluding()` run happened to keep — the same identity in CI and locally.
 */
/**
 * Subjects the mechanism had to disambiguate, by rule — the producer-quality signal.
 *
 * **Why this exists.** `disambiguateIdentities` guarantees that a rule's findings have distinct
 * identities, which silently turned every `new Set(hashes).size === findings.length` assertion
 * in the suite into a tautology. Measured: collapsing `duplicate-bodies.ts`'s identity to a
 * literal constant — the worst producer defect available — left **all 234 files and 3178 tests
 * green**, including `baseline-portability.test.ts`, whose own comment says *"collision is the
 * failure mode this primitive introduces, so it gets its own guard."*
 *
 * The mechanism is a safety net, not a licence for producers to stop identifying their
 * findings: a positional suffix makes an entry a *slot*, while a producer identity makes it a
 * *reference*, and only the latter survives a sibling being deleted (see the ordering table
 * above). So the guards must keep measuring the producer, and after this mechanism the only
 * way to do that is to ask what the mechanism had to repair.
 *
 * Same shape as `recordEdgeCoverage`/`untestedRules` next door, for the same reason: a
 * disclosure channel that a test can assert on without the production path knowing it exists.
 */
const collisions: { rule: string; subject: string; findings: number }[] = []

/** Every subject a rule produced more than once, since the last reset. */
export function identityCollisions(): readonly {
  rule: string
  subject: string
  findings: number
}[] {
  return collisions
}

/** Clear the record — call in a `beforeEach` when asserting on a specific rule. */
export function resetIdentityCollisions(): void {
  collisions.length = 0
}

registerCacheReset(resetIdentityCollisions)

export function disambiguateIdentities(violations: ArchViolation[]): ArchViolation[] {
  const counts = new Map<string, number>()
  for (const violation of violations) {
    const key = groupKeyOf(violation)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  // Nothing collides: return the input untouched rather than rebuilding it, so the
  // overwhelmingly common case costs one pass and no allocation.
  let anyDuplicate = false
  for (const count of counts.values()) {
    if (count > 1) {
      anyDuplicate = true
      break
    }
  }
  if (!anyDuplicate) return violations

  // Disclose what had to be repaired, so a guard can still measure the PRODUCER — see
  // `identityCollisions`. Recorded before the repair, because afterwards there is nothing left
  // to see, which is precisely how this mechanism disarmed the existing collision guards.
  for (const [key, count] of counts) {
    if (count > 1) {
      const split = key.indexOf('::')
      collisions.push({
        rule: key.slice(0, split),
        subject: key.slice(split + 2),
        findings: count,
      })
    }
  }

  // Every key present before suffixing, so a generated `#n` can never land on one a producer
  // already emits. Without it, a rule holding `X` twice plus a literal `X#1` closes one
  // collision by opening another — and `taken.add` below is what keeps that true for the
  // THIRD member: without it, `[X, X, X, X#1]` yields `X, X#2, X#2, X#1`, reintroducing the
  // collision this function exists to remove. Measured; it takes a group of three to reach,
  // which is why the guard for it carries three.
  const taken = new Set(counts.keys())
  const seen = new Map<string, number>()

  return violations.map((violation) => {
    const key = groupKeyOf(violation)
    if ((counts.get(key) ?? 0) < 2) return violation

    const occurrence = (seen.get(key) ?? 0) + 1
    seen.set(key, occurrence)
    // The first keeps its subject verbatim — this is what makes the migration empty.
    if (occurrence === 1) return violation

    // The suffix goes on the SUBJECT, because that is what `identity` is; the reservation is
    // checked on the group key, because that is what collides.
    const subject = subjectOf(violation)
    let suffix = occurrence - 1
    let candidate = `${subject}#${String(suffix)}`
    while (taken.has(`${violation.rule}::${candidate}`)) {
      suffix += 1
      candidate = `${subject}#${String(suffix)}`
    }
    taken.add(`${violation.rule}::${candidate}`)
    return { ...violation, identity: candidate }
  })
}
