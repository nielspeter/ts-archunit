import type { Node } from 'ts-morph'

/**
 * A single architecture rule violation.
 *
 * Represents one element that failed to satisfy a condition.
 * Basic structure — extended with codeFrame and suggestion in plan 0006.
 */
export interface ArchViolation {
  /** Human-readable rule description (from the fluent chain) */
  rule: string
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
}

/**
 * Extract a human-readable name from a ts-morph Node.
 *
 * Handles classes, functions, interfaces, type aliases, variable declarations,
 * and methods. Falls back to the node's kind name for unknown node types.
 */
export function getElementName(node: Node): string {
  // Node types with a getName() method
  if ('getName' in node && typeof (node as Record<string, unknown>).getName === 'function') {
    const name = (node as { getName(): string | undefined }).getName()
    if (name !== undefined) return name
  }
  // Fallback: use the node's kind name (e.g. "VariableDeclaration")
  return node.getKindName()
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
  context: { rule: string; because?: string },
): ArchViolation {
  return {
    rule: context.rule,
    element: getElementName(node),
    file: getElementFile(node),
    line: getElementLine(node),
    message,
    because: context.because,
  }
}
