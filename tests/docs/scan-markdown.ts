import type { DeprecatedSymbol } from './deprecated-symbols.js'

/** A living documentation file: its repo-relative path and full text. */
export interface DocFile {
  readonly path: string
  readonly text: string
}

/** One place a doc teaches a deprecated symbol. */
export interface Hit {
  readonly path: string
  readonly line: number
  readonly name: string
  readonly replacement: string
  readonly declaredAt: string
  /** Whether the match was `.name(` or a bare `name` — the message must not render a call form the line does not contain. */
  readonly matchedAs: 'dotted' | 'bare'
  readonly collides: boolean
}

/**
 * The match rule for one symbol.
 *
 * - **Colliding** name → `\.name(?!\w)`. The bare name is legitimately documented
 *   (it is also a live export), so only the dotted call form is rot. Matching bare
 *   here produces false positives on correct reference tables — and a scan that
 *   reddens correct docs gets suppressed, which is the outcome ADR-008 rule 3 warns
 *   about.
 * - **Solo** name → `\bname(?!\w)`. Any mention is rot. This is what catches bare
 *   names in two-column tables, where no call form appears.
 *
 * `(?!\w)` is required, not cosmetic: `notImportFromCondition` is a strict prefix of
 * `notImportFromConditionWithOptions`.
 */
export function patternFor(symbol: DeprecatedSymbol): RegExp {
  // No /g flag: `lastIndex` is stateful on a shared RegExp, which would make hits
  // depend on scan order.
  return symbol.collides
    ? new RegExp(`\\.${symbol.name}(?!\\w)`)
    : new RegExp(`\\b${symbol.name}(?!\\w)`)
}

/**
 * Scan living docs for deprecated API, one hit per symbol per line.
 *
 * Line-granular so the message can name a location, and de-duplicated per line so a
 * symbol repeated on one line reports once.
 */
export function scanMarkdown(
  files: readonly DocFile[],
  symbols: readonly DeprecatedSymbol[],
): Hit[] {
  const hits: Hit[] = []
  const patterns = symbols.map((symbol) => ({ symbol, pattern: patternFor(symbol) }))

  for (const file of files) {
    const lines = file.text.split('\n')
    lines.forEach((line, index) => {
      for (const { symbol, pattern } of patterns) {
        if (!pattern.test(line)) continue
        hits.push({
          path: file.path,
          line: index + 1,
          name: symbol.name,
          replacement: symbol.replacement,
          declaredAt: symbol.declaredAt,
          matchedAs: symbol.collides ? 'dotted' : 'bare',
          collides: symbol.collides,
        })
      }
    })
  }

  return hits
}

/**
 * Render one hit as an agent-actionable finding (ADR-008 rule 2): where it is, what
 * to write instead, and — only where the name is ambiguous — which of the two things
 * sharing this name is the deprecated one.
 */
export function format(hit: Hit): string {
  const shown = hit.matchedAs === 'dotted' ? `.${hit.name}()` : hit.name
  const lines = [
    `${hit.path}:${String(hit.line)} — \`${shown}\` is deprecated.`,
    `  FIX: ${hit.replacement}`,
  ]
  if (hit.collides) {
    lines.push(
      `  This is the builder method (${hit.declaredAt}) — NOT the \`${hit.name}\` ` +
        'export of the same name, which is current.',
    )
  }
  return lines.join('\n')
}
