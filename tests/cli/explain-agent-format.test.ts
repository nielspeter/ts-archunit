import { describe, it, expect, vi, afterEach } from 'vitest'
import { runExplain } from '../../src/cli/commands/explain.js'

vi.mock('../../src/cli/load-rules.js', () => ({ loadRuleFiles: vi.fn() }))

import { loadRuleFiles } from '../../src/cli/load-rules.js'
import type { RuleDescription } from '../../src/core/rule-description.js'

const mockLoad = vi.mocked(loadRuleFiles)

/** Run explain --format agent over the given rule descriptions; return stdout. */
async function runAgent(descs: RuleDescription[]): Promise<string> {
  const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  mockLoad.mockResolvedValue(descs.map((d) => ({ describeRule: () => d, violations: () => [] })))
  await runExplain({ ruleFiles: ['rules.ts'], format: 'agent' })
  return spy.mock.calls.map((c) => String(c[0])).join('')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('explain --format agent', () => {
  it('wraps output in sentinel markers and includes the check-in-loop preamble', async () => {
    const out = await runAgent([{ rule: 'r', id: 'a/one', imperative: 'Do NOT do X' }])
    expect(out).toContain('<!-- ts-archunit:start -->')
    expect(out).toContain('<!-- ts-archunit:end -->')
    expect(out).toContain('npx ts-archunit check --format json')
    expect(out.indexOf('<!-- ts-archunit:start -->')).toBeLessThan(
      out.indexOf('<!-- ts-archunit:end -->'),
    )
  })

  it('renders the imperative as a bullet without the because (because lives in the check json)', async () => {
    const out = await runAgent([
      { rule: 'r', id: 'x/y', imperative: 'Do NOT throw new Error()', because: 'loses context' },
    ])
    expect(out).toContain('- Do NOT throw new Error()')
    expect(out).not.toContain('loses context')
  })

  it('groups rules by the id namespace', async () => {
    const out = await runAgent([
      { rule: 'r', id: 'preset/agent/no-eval', imperative: 'Do NOT call eval' },
      { rule: 'r', id: 'naming/get', imperative: 'MUST prefix with get' },
    ])
    expect(out).toContain('### Preset')
    expect(out).toContain('### Naming')
  })

  it('preserves regex patterns verbatim', async () => {
    const out = await runAgent([
      { rule: 'r', id: 'svc/repo', imperative: 'MUST call a method matching /Repository/' },
    ])
    expect(out).toContain('/Repository/')
  })

  it('emits the block with "No rules found." when there are none', async () => {
    const out = await runAgent([])
    expect(out).toContain('<!-- ts-archunit:start -->')
    expect(out).toContain('No rules found')
    expect(out).toContain('<!-- ts-archunit:end -->')
  })

  it('falls back to the rule description when no imperative is set', async () => {
    const out = await runAgent([{ rule: 'that resides in X should not import Y' }])
    expect(out).toContain('- that resides in X should not import Y')
  })
})
