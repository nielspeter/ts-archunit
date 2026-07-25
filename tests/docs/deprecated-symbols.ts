import { Node, SyntaxKind } from 'ts-morph'
import type { Project } from 'ts-morph'

/**
 * A `@deprecated` symbol in `src/`, with everything the docs scan needs.
 *
 * Every field is DERIVED from source — nothing here is hand-maintained, because a
 * hand-maintained list of deprecated names is exactly the artifact that rots while
 * the guard keeps reporting green.
 */
export interface DeprecatedSymbol {
  readonly name: string
  /** The tag's own guidance text — this becomes the FIX line in a violation. */
  readonly replacement: string
  /** `file:line` of the declaration, reported so a human can go read it (ADR-008). */
  readonly declaredAt: string
  /**
   * True when the name is ALSO a live public export.
   *
   * `shouldExtend` is both a deprecated builder method and a current standalone
   * condition, so `api-reference.md` documents the name legitimately. For these,
   * only a dotted call (`.shouldExtend(`) is rot; a bare mention is not.
   */
  readonly collides: boolean
}

/** ts-morph strips the ` * ` gutter but keeps newlines; some tags wrap. */
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Collect every `@deprecated` symbol by asking ts-morph for the TAG.
 *
 * Deliberately not "walk declarations that look deprecatable" — that is a
 * hand-coded list of node shapes, and it misses cases like an exported const arrow
 * whose JSDoc lives on the VariableStatement. The tag knows where it is; we do not
 * have to guess, and the set cannot silently under-collect as `src/` grows.
 */
export function readDeprecatedSymbols(
  project: Project,
  sourceGlob = 'src/**/*.ts',
  entryPoint = 'src/index.ts',
): DeprecatedSymbol[] {
  // Keyed by the EXPORTED name, so an aliased re-export
  // (`haveNameMatching as conditionHaveNameMatching`) resolves natively.
  const exported = new Set(
    project.getSourceFileOrThrow(entryPoint).getExportedDeclarations().keys(),
  )
  const found = new Map<string, DeprecatedSymbol>()

  for (const sourceFile of project.getSourceFiles(sourceGlob)) {
    for (const tag of sourceFile.getDescendantsOfKind(SyntaxKind.JSDocDeprecatedTag)) {
      const declaration = tag.getFirstAncestor(
        (ancestor) => Node.isJSDocable(ancestor) && Node.hasName(ancestor),
      )
      if (declaration === undefined || !Node.hasName(declaration)) continue

      const name = declaration.getName()
      // Same name, same guidance — verified true for every duplicate today, and
      // first-wins is honest: a divergent second tag would be a src/ bug, not
      // something this scan should paper over with a merge strategy.
      if (found.has(name)) continue

      found.set(name, {
        name,
        replacement: normalise(tag.getCommentText() ?? ''),
        declaredAt: `${sourceFile.getFilePath()}:${String(declaration.getStartLineNumber())}`,
        collides: exported.has(name),
      })
    }
  }

  return [...found.values()]
}
