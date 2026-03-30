import type { RuleDescription } from '../../core/rule-description.js'
import { loadRuleFiles } from '../load-rules.js'

export interface ExplainArgs {
  ruleFiles: string[]
  markdown?: boolean
}

interface Describable {
  describeRule(): RuleDescription
}

function isDescribable(value: unknown): value is Describable {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    'describeRule' in value &&
    typeof (value as Record<string, unknown>)['describeRule'] === 'function'
  )
}

/**
 * Dump all active rules as structured JSON or markdown.
 */
export async function runExplain(args: ExplainArgs): Promise<void> {
  const builders = await loadRuleFiles(args.ruleFiles)

  const descriptions: RuleDescription[] = []
  for (const builder of builders) {
    if (isDescribable(builder)) {
      descriptions.push(builder.describeRule())
    }
  }

  if (args.markdown) {
    outputMarkdown(descriptions)
  } else {
    outputJson(descriptions)
  }
}

function outputJson(descriptions: RuleDescription[]): void {
  const output = {
    rules: descriptions,
    generatedAt: new Date().toISOString(),
  }
  process.stdout.write(JSON.stringify(output, null, 2) + '\n')
}

function outputMarkdown(descriptions: RuleDescription[]): void {
  if (descriptions.length === 0) {
    process.stdout.write('No rules found.\n')
    return
  }

  process.stdout.write('| ID | Rule | Because | Suggestion |\n')
  process.stdout.write('|----|------|---------|------------|\n')
  for (const d of descriptions) {
    const id = d.id ?? '-'
    const rule = d.rule || '-'
    const because = d.because ?? '-'
    const suggestion = d.suggestion ?? '-'
    process.stdout.write(`| ${id} | ${rule} | ${because} | ${suggestion} |\n`)
  }
}
