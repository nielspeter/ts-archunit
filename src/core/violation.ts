import { Node } from 'ts-morph'
import { generateCodeFrame } from './code-frame.js'

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
 * three of the four suppression paths already refuse to silence these —
 * `.excluding()` refuses explicitly, baseline and diff honour the flag.
 *
 * Applied at all three severity-stamping sites. `stampSeverity` alone is not
 * enough: `.violations()` inlines its own map in both root builders, and the
 * `executeWarn` path resolves an unset severity to `warn`, which is where five
 * of the six producers landed.
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

  return parts.length > 0 ? parts.join('.') : node.getKindName()
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
