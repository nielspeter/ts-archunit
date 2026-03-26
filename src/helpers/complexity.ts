import { SyntaxKind, Node } from 'ts-morph'
import type { ClassDeclaration } from 'ts-morph'

/** Decision-point SyntaxKinds that increment cyclomatic complexity */
const DECISION_KINDS = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.ConditionalExpression,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CatchClause,
  SyntaxKind.CaseClause,
])

/** Logical operator tokens that add branching */
const LOGICAL_OPERATORS = new Set([
  SyntaxKind.AmpersandAmpersandToken, // &&
  SyntaxKind.BarBarToken, // ||
  SyntaxKind.QuestionQuestionToken, // ??
])

/**
 * Calculate cyclomatic complexity (McCabe) for a function body.
 *
 * Accepts the body Node directly (from ArchFunction.getBody(),
 * MethodDeclaration.getBody(), etc.).
 *
 * Complexity = 1 + number of decision points.
 * Returns 1 for an undefined/empty body (one path through).
 */
export function cyclomaticComplexity(body: Node | undefined): number {
  if (!body) return 1

  let complexity = 1

  for (const descendant of body.getDescendants()) {
    if (DECISION_KINDS.has(descendant.getKind())) {
      complexity++
    }

    // Count logical operators in binary expressions
    if (Node.isBinaryExpression(descendant)) {
      const opKind = descendant.getOperatorToken().getKind()
      if (LOGICAL_OPERATORS.has(opKind)) {
        complexity++
      }
    }
  }

  return complexity
}

/**
 * Count lines spanned by a node (from first line to last line, inclusive).
 *
 * This is a "span lines" count — it includes blank lines and comments
 * within the node's range. This is consistent with how editors report
 * function/class length, and avoids the fragility of text-based
 * comment stripping.
 */
export function linesOfCode(node: Node): number {
  return node.getEndLineNumber() - node.getStartLineNumber() + 1
}

/**
 * Count the number of methods on a class.
 */
export function methodCount(cls: ClassDeclaration): number {
  return cls.getMethods().length
}
