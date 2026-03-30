import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * Test the explain command's internal functions directly.
 *
 * The exported `runExplain` calls `loadRuleFiles` (which does dynamic imports),
 * so we mock that dependency. The `isDescribable` type guard and output formatting
 * are tested through `runExplain` by controlling what `loadRuleFiles` returns.
 */

// Mock loadRuleFiles so we don't need real rule files on disk
vi.mock('../../src/cli/load-rules.js', () => ({
  loadRuleFiles: vi.fn(),
}))

import { runExplain } from '../../src/cli/commands/explain.js'
import { loadRuleFiles } from '../../src/cli/load-rules.js'
import type { RuleBuilderLike } from '../../src/cli/load-rules.js'
import type { RuleDescription } from '../../src/core/rule-description.js'

const mockedLoadRuleFiles = vi.mocked(loadRuleFiles)

/** Helper: create a mock builder with optional describeRule for testing */
function mockBuilder(extra?: Record<string, unknown>): RuleBuilderLike {
  return Object.assign({ check: () => undefined }, extra) as RuleBuilderLike
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isDescribable type guard (via runExplain)', () => {
  it('skips objects without describeRule method', async () => {
    mockedLoadRuleFiles.mockResolvedValue([
      mockBuilder(), // no describeRule
    ])

    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })

    await runExplain({ ruleFiles: ['fake.ts'] })
    const output = chunks.join('')
    const parsed = JSON.parse(output) as { rules: RuleDescription[] }
    expect(parsed.rules).toHaveLength(0)
  })

  it('includes objects that have a describeRule function', async () => {
    const desc: RuleDescription = {
      rule: 'classes should not import from controllers',
      id: 'no-ctrl-import',
      because: 'layering',
    }
    mockedLoadRuleFiles.mockResolvedValue([mockBuilder({ describeRule: () => desc })])

    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })

    await runExplain({ ruleFiles: ['fake.ts'] })
    const output = chunks.join('')
    const parsed = JSON.parse(output) as { rules: RuleDescription[] }
    expect(parsed.rules).toHaveLength(1)
    expect(parsed.rules[0]!.id).toBe('no-ctrl-import')
  })

  it('skips null and undefined values', async () => {
    mockedLoadRuleFiles.mockResolvedValue([
      null as unknown as RuleBuilderLike,
      undefined as unknown as RuleBuilderLike,
    ])

    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })

    await runExplain({ ruleFiles: ['fake.ts'] })
    const output = chunks.join('')
    const parsed = JSON.parse(output) as { rules: RuleDescription[] }
    expect(parsed.rules).toHaveLength(0)
  })

  it('skips objects where describeRule is not a function', async () => {
    mockedLoadRuleFiles.mockResolvedValue([mockBuilder({ describeRule: 'not-a-function' })])

    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })

    await runExplain({ ruleFiles: ['fake.ts'] })
    const output = chunks.join('')
    const parsed = JSON.parse(output) as { rules: RuleDescription[] }
    expect(parsed.rules).toHaveLength(0)
  })

  it('skips primitive values (strings, numbers)', async () => {
    mockedLoadRuleFiles.mockResolvedValue([
      'a string' as unknown as RuleBuilderLike,
      42 as unknown as RuleBuilderLike,
    ])

    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })

    await runExplain({ ruleFiles: ['fake.ts'] })
    const output = chunks.join('')
    const parsed = JSON.parse(output) as { rules: RuleDescription[] }
    expect(parsed.rules).toHaveLength(0)
  })
})

describe('runExplain JSON output', () => {
  it('outputs valid JSON with rules array and generatedAt timestamp', async () => {
    const desc: RuleDescription = {
      rule: 'modules should not import from routes',
      id: 'mod/no-routes',
      because: 'layer violation',
      suggestion: 'use a service instead',
    }
    mockedLoadRuleFiles.mockResolvedValue([mockBuilder({ describeRule: () => desc })])

    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })

    await runExplain({ ruleFiles: ['rules.ts'] })
    const output = chunks.join('')
    const parsed = JSON.parse(output) as { rules: RuleDescription[]; generatedAt: string }

    expect(parsed.rules).toHaveLength(1)
    expect(parsed.rules[0]).toEqual(desc)
    expect(parsed.generatedAt).toBeDefined()
    // generatedAt should be a valid ISO date string
    expect(new Date(parsed.generatedAt).toISOString()).toBe(parsed.generatedAt)
  })

  it('outputs empty rules array when no describable builders', async () => {
    mockedLoadRuleFiles.mockResolvedValue([])

    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })

    await runExplain({ ruleFiles: ['rules.ts'] })
    const output = chunks.join('')
    const parsed = JSON.parse(output) as { rules: RuleDescription[] }
    expect(parsed.rules).toHaveLength(0)
  })

  it('collects multiple describable builders', async () => {
    const desc1: RuleDescription = { rule: 'rule one', id: 'r1' }
    const desc2: RuleDescription = { rule: 'rule two', id: 'r2' }

    mockedLoadRuleFiles.mockResolvedValue([
      mockBuilder({ describeRule: () => desc1 }),
      mockBuilder(), // not describable, skipped
      mockBuilder({ describeRule: () => desc2 }),
    ])

    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })

    await runExplain({ ruleFiles: ['rules.ts'] })
    const output = chunks.join('')
    const parsed = JSON.parse(output) as { rules: RuleDescription[] }
    expect(parsed.rules).toHaveLength(2)
    expect(parsed.rules[0]!.id).toBe('r1')
    expect(parsed.rules[1]!.id).toBe('r2')
  })
})

describe('runExplain markdown output', () => {
  it('outputs markdown table with header row', async () => {
    const desc: RuleDescription = {
      rule: 'classes should extend BaseService',
      id: 'svc/base',
      because: 'consistency',
      suggestion: 'extend BaseService',
    }
    mockedLoadRuleFiles.mockResolvedValue([mockBuilder({ describeRule: () => desc })])

    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })

    await runExplain({ ruleFiles: ['rules.ts'], markdown: true })
    const output = chunks.join('')
    const lines = output.split('\n').filter((l) => l.length > 0)

    // Header
    expect(lines[0]).toBe('| ID | Rule | Because | Suggestion |')
    // Separator
    expect(lines[1]).toBe('|----|------|---------|------------|')
    // Data row
    expect(lines[2]).toContain('svc/base')
    expect(lines[2]).toContain('classes should extend BaseService')
    expect(lines[2]).toContain('consistency')
    expect(lines[2]).toContain('extend BaseService')
  })

  it('uses dash for missing optional fields', async () => {
    const desc: RuleDescription = {
      rule: 'modules should not cycle',
    }
    mockedLoadRuleFiles.mockResolvedValue([mockBuilder({ describeRule: () => desc })])

    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })

    await runExplain({ ruleFiles: ['rules.ts'], markdown: true })
    const output = chunks.join('')
    const lines = output.split('\n').filter((l) => l.length > 0)

    // Data row should have dashes for missing id, because, suggestion
    expect(lines[2]).toBe('| - | modules should not cycle | - | - |')
  })

  it('outputs "No rules found." for empty rules in markdown mode', async () => {
    mockedLoadRuleFiles.mockResolvedValue([])

    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })

    await runExplain({ ruleFiles: ['rules.ts'], markdown: true })
    const output = chunks.join('')
    expect(output).toBe('No rules found.\n')
  })

  it('renders multiple rows in markdown', async () => {
    const descs: RuleDescription[] = [
      { rule: 'rule A', id: 'a', because: 'reason A', suggestion: 'fix A' },
      { rule: 'rule B', id: 'b', because: 'reason B', suggestion: 'fix B' },
    ]
    mockedLoadRuleFiles.mockResolvedValue(descs.map((d) => mockBuilder({ describeRule: () => d })))

    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })

    await runExplain({ ruleFiles: ['rules.ts'], markdown: true })
    const output = chunks.join('')
    const lines = output.split('\n').filter((l) => l.length > 0)

    // Header + separator + 2 data rows = 4 lines
    expect(lines).toHaveLength(4)
    expect(lines[2]).toContain('rule A')
    expect(lines[3]).toContain('rule B')
  })
})
