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
  /** Optional rationale provided via .because() */
  because?: string
  /** Source code snippet around the violation line */
  codeFrame?: string
  /** Actionable suggestion for fixing the violation (e.g. "Replace parseInt() with this.extractCount()") */
  suggestion?: string
  /** Link to documentation — ADR, wiki, style guide */
  docs?: string
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
