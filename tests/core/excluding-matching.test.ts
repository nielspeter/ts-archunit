import { describe, it, expect, vi, afterEach } from 'vitest'
import { applyFilters } from '../../src/core/execute-rule.js'
import type { ArchViolation } from '../../src/core/violation.js'
import { silent } from '../../src/core/silent-exclusion.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function makeViolation(overrides: Partial<ArchViolation> = {}): ArchViolation {
  return {
    rule: 'test rule',
    element: 'CallExpression',
    file: '/src/routes/images.ts',
    line: 128,
    message: 'app.get(/images) missing preHandler',
    ...overrides,
  }
}

describe('BUG-0001: .excluding() matches element, file, and message', () => {
  describe('current behavior — matching against element', () => {
    it('exact string matches element', () => {
      const violations = [makeViolation()]
      const result = applyFilters(violations, { exclusions: ['CallExpression'] })
      expect(result).toHaveLength(0)
    })

    it('regex matches element', () => {
      const violations = [makeViolation()]
      const result = applyFilters(violations, { exclusions: [/CallExpression/] })
      expect(result).toHaveLength(0)
    })
  })

  describe('NEW: matching against file path', () => {
    it('regex matches violation.file', () => {
      const violations = [makeViolation()]
      const result = applyFilters(violations, { exclusions: [/images\.ts/] })
      expect(result).toHaveLength(0)
    })

    it('exact string matches violation.file', () => {
      const violations = [makeViolation()]
      const result = applyFilters(violations, {
        exclusions: ['/src/routes/images.ts'],
      })
      expect(result).toHaveLength(0)
    })

    it('file regex excludes only the matching violation', () => {
      const violations = [
        makeViolation({ file: '/src/routes/images.ts' }),
        makeViolation({ file: '/src/routes/users.ts' }),
      ]
      const result = applyFilters(violations, { exclusions: [/images\.ts/] })
      expect(result).toHaveLength(1)
      expect(result[0]!.file).toBe('/src/routes/users.ts')
    })
  })

  describe('NEW: matching against message', () => {
    it('regex matches violation.message', () => {
      const violations = [makeViolation()]
      const result = applyFilters(violations, { exclusions: [/missing preHandler/] })
      expect(result).toHaveLength(0)
    })

    it('exact string matches violation.message', () => {
      const violations = [makeViolation()]
      const result = applyFilters(violations, {
        exclusions: ['app.get(/images) missing preHandler'],
      })
      expect(result).toHaveLength(0)
    })

    it('message regex excludes only the matching violation', () => {
      const violations = [
        makeViolation({
          file: '/src/routes/a.ts',
          message: 'app.get(/images) missing preHandler',
        }),
        makeViolation({
          file: '/src/routes/b.ts',
          message: 'app.get(/users) missing preHandler',
        }),
      ]
      // /images/ should only match the first violation's message (not file path)
      const result = applyFilters(violations, { exclusions: [/images/] })
      expect(result).toHaveLength(1)
      expect(result[0]!.message).toBe('app.get(/users) missing preHandler')
    })
  })

  describe('stale exclusion warnings still work', () => {
    it('warns when an exclusion matches nothing', () => {
      const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const violations = [makeViolation()]
      applyFilters(violations, {
        exclusions: [/nonexistent/],
        metadata: { id: 'test-rule' },
      })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unused exclusion'))
    })

    it('does not warn when exclusion matches via file', () => {
      const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const violations = [makeViolation()]
      applyFilters(violations, {
        exclusions: [/images\.ts/],
        metadata: { id: 'test-rule' },
      })
      expect(warn).not.toHaveBeenCalled()
    })
  })

  describe('BUG-0008: element names from getElementName() enable excluding', () => {
    it('class name as element is excludable by exact string', () => {
      // After BUG-0008 fix: createViolation() produces meaningful element names
      // (e.g., "AssetService.getAssetDisplayName") instead of AST kind names.
      // This test verifies that excluding works when element has the class name.
      const violations = [
        makeViolation({
          element: 'AssetService.getAssetDisplayName',
          message: 'AssetService.getAssetDisplayName uses type assertion',
        }),
      ]
      const result = applyFilters(violations, {
        exclusions: ['AssetService.getAssetDisplayName'],
      })
      expect(result).toHaveLength(0)
    })

    it('regex excludes by class name pattern in element', () => {
      const violations = [
        makeViolation({
          element: 'AssetService.getAssetDisplayName',
          message: 'uses type assertion',
        }),
      ]
      const result = applyFilters(violations, { exclusions: [/AssetService/] })
      expect(result).toHaveLength(0)
    })

    it('string exclusion uses exact match — no accidental over-matching', () => {
      const violations = [
        makeViolation({
          element: 'AssetService.getAssetDisplayName',
          message: 'uses type assertion',
        }),
      ]
      // 'Service' does NOT match — it's a substring, not the full element name
      const result = applyFilters(violations, { exclusions: ['Service'] })
      expect(result).toHaveLength(1)
    })
  })

  describe('silent exclusions suppress unused-exclusion warnings', () => {
    it('silent exclusion matching nothing does not warn', () => {
      const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const violations = [makeViolation()]
      const silentPattern = silent(/nonexistent/)
      applyFilters(violations, {
        exclusions: [silentPattern.pattern],
        silentIndices: new Set([0]),
        metadata: { id: 'test-rule' },
      })
      expect(warn).not.toHaveBeenCalled()
    })

    it('non-silent exclusion matching nothing still warns', () => {
      const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const violations = [makeViolation()]
      applyFilters(violations, {
        exclusions: [/nonexistent/],
        silentIndices: new Set(),
        metadata: { id: 'test-rule' },
      })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unused exclusion'))
    })

    it('mixed silent and non-silent: only non-silent warns', () => {
      const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const violations = [makeViolation()]
      // Index 0 = silent (no match), Index 1 = non-silent (no match)
      applyFilters(violations, {
        exclusions: [/\.d\.ts$/, /also-nonexistent/],
        silentIndices: new Set([0]),
        metadata: { id: 'test-rule' },
      })
      // Only the non-silent pattern should trigger a warning
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('also-nonexistent'))
    })

    it('silent exclusion still filters violations when it matches', () => {
      const violations = [makeViolation()]
      const result = applyFilters(violations, {
        exclusions: [/images\.ts/],
        silentIndices: new Set([0]),
      })
      expect(result).toHaveLength(0) // still filters, just doesn't warn when unused
    })

    it('silent() helper creates correct SilentExclusion shape', () => {
      const s = silent(/\.d\.ts$/)
      expect(s.pattern).toEqual(/\.d\.ts$/)
    })
  })

  describe('real-world scenario from BUG-0001', () => {
    it('can exclude specific file while keeping other violations', () => {
      const violations = [
        makeViolation({
          element: 'CallExpression',
          file: '/src/routes/images.ts',
          message: 'app.get(/images) missing preHandler',
        }),
        makeViolation({
          element: 'CallExpression',
          file: '/src/routes/platform/index.ts',
          message: 'app.get(/platform) missing preHandler',
        }),
        makeViolation({
          element: 'CallExpression',
          file: '/src/routes/users.ts',
          message: 'app.get(/users) missing preHandler',
        }),
      ]

      // Exclude the two intentional exceptions by file path
      const result = applyFilters(violations, {
        exclusions: [/images\.ts/, /platform\/index\.ts/],
      })

      // Only the users.ts violation should remain
      expect(result).toHaveLength(1)
      expect(result[0]!.file).toBe('/src/routes/users.ts')
    })
  })

  describe('bypassFilters meta-findings are not excludable', () => {
    /**
     * A config-level meta-finding reports that the rule checks NOTHING, so
     * silencing it silences the guard itself (ADR-008). Baseline and diff-aware
     * already honor the flag; `.excluding()` must too — and this became reachable
     * once meta-messages started quoting the caller's own globs and paths, which
     * an unrelated path exclusion can incidentally match.
     */
    it('survives an exclusion that matches its message', () => {
      const meta = makeViolation({
        element: 'slices',
        file: '',
        message: 'every slice in assignedFrom(...) is empty (globs: "src/services/**")',
        bypassFilters: true,
      })
      const result = applyFilters([meta], { exclusions: [/src\/services/] })
      expect(result).toHaveLength(1)
    })

    it('survives an exclusion that matches its element exactly', () => {
      const meta = makeViolation({ element: 'slices', file: '', bypassFilters: true })
      expect(applyFilters([meta], { exclusions: ['slices'] })).toHaveLength(1)
    })

    it('warns that the exclusion was REFUSED, not that it is stale', () => {
      // "may be stale after a rename" is false here and points at the wrong fix.
      const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const meta = makeViolation({ element: 'slices', file: '', bypassFilters: true })
      applyFilters([meta], { exclusions: ['slices'], metadata: { id: 'x/y' } })
      const text = warn.mock.calls.map((call) => String(call[0])).join('\n')
      expect(text).toContain('cannot be excluded')
      expect(text).not.toContain('stale after a rename')
    })

    it('still excludes an ordinary violation with the same message text', () => {
      // Proves the guard is scoped to the flag, not a blanket "never exclude".
      const normal = makeViolation({
        element: 'X',
        file: '/src/services/a.ts',
        message: 'every slice in assignedFrom(...) is empty (globs: "src/services/**")',
      })
      expect(applyFilters([normal], { exclusions: [/src\/services/] })).toHaveLength(0)
    })
  })

  describe('plan 0104: an over-broad exclusion on cycle edges is caught mechanically', () => {
    /**
     * Cycle-edge-shaped violations, the way `beFreeOfCycles` produces them: every edge
     * in one SCC shares the SAME "part of a cycle with: ..." membership clause.
     */
    function cycleEdge(from: string, to: string, members: readonly string[]): ArchViolation {
      return makeViolation({
        element: `${from} -> ${to}`,
        file: `/src/${from}/index.ts`,
        message: `Cycle detected: "${from}" imports "${to}", part of a cycle with: ${members.join(', ')}`,
        identity: `cycle-edge::${from}->${to}`,
      })
    }

    it('a regex matching 2+ distinct cycle edges warns, naming every matched edge', () => {
      const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const members = ['a', 'b', 'c']
      const violations = [
        cycleEdge('a', 'b', members),
        cycleEdge('b', 'c', members),
        cycleEdge('c', 'a', members),
      ]
      // A loose regex over the still-present "part of a cycle with: ..." clause —
      // exactly the loophole a migrator reaching for a whole-component pattern hits.
      applyFilters(violations, {
        exclusions: [/part of a cycle with: a, b, c/],
        metadata: { id: 'test/no-cycles' },
      })
      const text = warn.mock.calls.map((call) => String(call[0])).join('\n')
      expect(text).toContain('matched 3 distinct cycle edges')
      expect(text).toContain('a -> b')
      expect(text).toContain('b -> c')
      expect(text).toContain('c -> a')
      expect(text).toContain(".excluding('a -> b', 'b -> c', 'c -> a')")
    })

    it('CONTROL: an exact-string exclusion matching exactly one cycle edge does not warn', () => {
      const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const members = ['a', 'b', 'c']
      const violations = [cycleEdge('a', 'b', members), cycleEdge('b', 'c', members)]
      applyFilters(violations, {
        exclusions: ['a -> b'],
        metadata: { id: 'test/no-cycles' },
      })
      const text = warn.mock.calls.map((call) => String(call[0])).join('\n')
      expect(text).not.toContain('distinct cycle edges')
    })

    it('CONTROL: a broad exclusion in an unrelated (non-cycle) family does not warn', () => {
      // The check reads the `cycle-edge::` identity prefix, not "matched more than one
      // thing" in general — a legitimate broad exclusion in any other family (no
      // `identity` set at all, here) must not false-positive.
      //
      // `element` MUST differ between the two violations (review: testing — the
      // original version gave both `element: 'CallExpression'` via
      // `makeViolation`'s default, so `matchedCycleEdges`'s Set held one distinct
      // value regardless of the identity-prefix check, and this control passed
      // for the wrong reason: it proved the `edges.size > 1` size gate, not that
      // the check is family-scoped. Verified by reverting the `cycle-edge::`
      // check entirely and confirming this row now reds without the fix below).
      const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const violations = [
        makeViolation({ element: 'a', file: '/src/a.ts', message: 'notDependOn: a depends on b' }),
        makeViolation({ element: 'b', file: '/src/b.ts', message: 'notDependOn: b depends on c' }),
      ]
      applyFilters(violations, {
        exclusions: [/depends on/],
        metadata: { id: 'test/no-deps' },
      })
      const text = warn.mock.calls.map((call) => String(call[0])).join('\n')
      expect(text).not.toContain('distinct cycle edges')
    })
  })
})
