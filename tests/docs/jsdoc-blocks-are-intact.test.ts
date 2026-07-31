/**
 * A published JSDoc block must not be a fragment of a split comment.
 *
 * This file exists because of a defect it would have caught. Plan 0075 inserted
 * a `const cache = …` declaration into six builders by anchoring on the last
 * `/**` before the class. In two of them the match landed **inside a glob
 * literal in an `@example`** — `'/api/users/**` — which closed the doc comment
 * mid-example, emitted the statement, and reopened a comment on the `'` that
 * followed. Valid TypeScript, so `tsc`, ESLint, Prettier and all 2,632 tests
 * were green, while `dist/builders/module-rule-builder.d.ts` shipped this as the
 * class's entire documentation:
 *
 *     /** ')
 *      *   .because('domain must not depend on infrastructure')
 *
 * That is the IDE hover for `modules()` and `calls()`. Five reviewers found it;
 * nothing in the suite did.
 *
 * ## Why this parses instead of scanning lines
 *
 * The first version of this guard scanned lines for `/**` and `*\/` and produced
 * **13 false positives** — every one of them a glob string in ordinary code
 * (`src: '**\/${sourceRoot}/**'`), which a line scanner cannot distinguish from
 * a comment opener. That is the same confusion that caused the original defect,
 * reproduced in the guard meant to catch it. `tests/docs/doc-globs-are-anchored.test.ts`
 * reached the same conclusion for markdown: a parser knows what a line cannot.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { Node, Project } from 'ts-morph'

const srcDir = path.resolve(import.meta.dirname, '../../src')

/**
 * A doc comment is suspect when it opens with the **tail of an expression**.
 *
 * `')` is what the reopened half of a split comment looks like — a string
 * terminator followed by a closing bracket. A bare quote is not enough:
 * `/** "Floor" presets … *\/` (`cli/commands/init.ts:4`) is legitimate prose and
 * was flagged by the first version of this pattern. The discriminating shape is
 * a closer, optionally preceded by the quote that closed a broken literal.
 */
const CANNOT_START_A_DOC_COMMENT = /^['"`]?[)\]};,]/

interface Offence {
  file: string
  line: number
  text: string
}

describe('published JSDoc is not a fragment of a split comment', () => {
  const project = new Project({
    tsConfigFilePath: path.resolve(import.meta.dirname, '../../tsconfig.json'),
  })
  const files = project.getSourceFiles('src/**/*.ts')

  const offences: Offence[] = []
  for (const sourceFile of files) {
    for (const node of sourceFile.getDescendants()) {
      // ts-morph's own type guard, not a duck-typed `'getJsDocs' in node`:
      // the latter narrows to `Function` and every call off it is `any`, which
      // ADR-005 bars and which `npm run lint` caught in the first version.
      if (!Node.isJSDocable(node)) continue
      for (const doc of node.getJsDocs()) {
        const description = doc.getDescription().trim()
        if (description === '') continue
        if (CANNOT_START_A_DOC_COMMENT.test(description)) {
          offences.push({
            file: path.relative(srcDir, sourceFile.getFilePath()),
            line: doc.getStartLineNumber(),
            text: description.slice(0, 60),
          })
        }
      }
    }
  }

  it('actually reads the source tree and finds doc comments', () => {
    // Guard the guard. Every assertion below is over an empty set if the glob
    // misses or `getJsDocs` stops resolving — green, and checking nothing.
    expect(files.length).toBeGreaterThan(100)
    const documented = files.flatMap((f) => f.getClasses()).filter((c) => c.getJsDocs().length > 0)
    expect(documented.length).toBeGreaterThan(10)
  })

  it('has no doc comment that opens with a stray quote or bracket', () => {
    // Named, not counted (ADR-008 rule 4).
    expect(offences.map((o) => `${o.file}:${String(o.line)} — ${o.text}`)).toEqual([])
  })

  it('would have caught the shape the 0075 defect had', () => {
    // The discriminator: without it, a regex that never matches satisfies the
    // assertion above forever. This is the text that actually shipped.
    const scratch = new Project({ useInMemoryFileSystem: true })
    const broken = scratch.createSourceFile(
      '/broken.ts',
      [
        "/** ')",
        " *   .because('domain must not depend on infrastructure')",
        ' *   .check()',
        ' */',
        'export class ModuleRuleBuilder {}',
      ].join('\n'),
    )
    const descriptions = broken
      .getClasses()
      .flatMap((c) => c.getJsDocs())
      .map((d) => d.getDescription().trim())

    expect(descriptions).toHaveLength(1)
    expect(CANNOT_START_A_DOC_COMMENT.test(descriptions[0] ?? '')).toBe(true)
  })

  it('does not flag a legitimate doc comment', () => {
    // The other half of the discriminator: a rule that flagged everything would
    // also pass the test above.
    const scratch = new Project({ useInMemoryFileSystem: true })
    const fine = scratch.createSourceFile(
      '/fine.ts',
      [
        '/**',
        ' * Rule builder for module-level rules.',
        ' *',
        ' * @example',
        " * modules(project).that().resideInFolder('**\\/domain/**')",
        ' */',
        'export class Fine {}',
      ].join('\n'),
    )
    const descriptions = fine
      .getClasses()
      .flatMap((c) => c.getJsDocs())
      .map((d) => d.getDescription().trim())

    expect(descriptions).toHaveLength(1)
    expect(CANNOT_START_A_DOC_COMMENT.test(descriptions[0] ?? '')).toBe(false)
  })
})
