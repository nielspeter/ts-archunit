import { Node, SyntaxKind } from 'ts-morph'

/**
 * Result of scanning a single catch clause.
 */
export interface SilentCatchResult {
  /** The CatchClause node — used for violation line and code frame */
  node: Node
  /** Human-readable description of why this catch is silent */
  message: string
}

/**
 * Extract all binding names from a catch variable declaration.
 *
 * Handles simple bindings (`catch (err)`), object destructuring
 * (`catch ({ message, code })`), and array destructuring (`catch ([code, msg])`).
 */
function getBindingNames(nameNode: Node): Set<string> {
  if (Node.isIdentifier(nameNode)) {
    return new Set([nameNode.getText()])
  }

  if (Node.isObjectBindingPattern(nameNode) || Node.isArrayBindingPattern(nameNode)) {
    const names = new Set<string>()
    for (const element of nameNode.getElements()) {
      if (Node.isBindingElement(element)) {
        const elementName = element.getNameNode()
        if (Node.isIdentifier(elementName)) {
          names.add(elementName.getText())
        }
      }
    }
    return names
  }

  // Unknown binding pattern — treat as referenced to avoid false positives
  return new Set<string>()
}

/**
 * Find catch clauses in the body that don't reference the caught error.
 *
 * A catch clause is "silent" if:
 * 1. It has no binding at all (`catch { ... }`) — no error to reference
 * 2. It has a binding but no Identifier in the block body matches any binding name
 *
 * Uses a simple descendant Identifier walk instead of the Language Service's
 * findReferencesAsNodes() — catch variables are block-scoped so a name match
 * within the block is sufficient. This is faster and avoids edge cases where
 * findReferencesAsNodes() returns zero refs for destructured bindings.
 *
 * **Known limitations (false negatives):**
 * - Variable shadowing: `catch (err) { const err = new Error(); throw err }`
 *   — the `err` Identifier matches but refers to the redeclared variable.
 * - Nested catch with same name: `catch (err) { try { } catch (err) { log(err) } }`
 *   — the inner `err` usage satisfies the outer check.
 * Both are rare in practice and arguably code smells themselves.
 */
export function findSilentCatches(body: Node): SilentCatchResult[] {
  const results: SilentCatchResult[] = []

  for (const catchClause of body.getDescendantsOfKind(SyntaxKind.CatchClause)) {
    const varDecl = catchClause.getVariableDeclaration()

    if (!varDecl) {
      // catch { ... } — no binding at all, always a violation
      results.push({
        node: catchClause,
        message: 'catch block has no error binding — error is silently discarded',
      })
      continue
    }

    // Collect the binding names to search for
    const bindingNames = getBindingNames(varDecl.getNameNode())

    // No binding names extracted (e.g., unusual pattern) — skip to avoid false positive
    if (bindingNames.size === 0) continue

    // Walk the catch block for Identifier nodes matching any binding name
    const block = catchClause.getBlock()
    const hasReference = block
      .getDescendantsOfKind(SyntaxKind.Identifier)
      .some((id) => bindingNames.has(id.getText()))

    if (!hasReference) {
      const varName = varDecl.getName()
      results.push({
        node: catchClause,
        message: `catch block binds '${varName}' but never references it — error is silently discarded`,
      })
    }
  }

  return results
}
