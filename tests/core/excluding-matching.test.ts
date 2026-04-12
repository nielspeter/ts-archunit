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
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const violations = [makeViolation()]
      applyFilters(violations, {
        exclusions: [/nonexistent/],
        metadata: { id: 'test-rule' },
      })
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unused exclusion'))
    })

    it('does not warn when exclusion matches via file', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const violations = [makeViolation()]
      applyFilters(violations, {
        exclusions: [/images\.ts/],
        metadata: { id: 'test-rule' },
      })
      expect(console.warn).not.toHaveBeenCalled()
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
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const violations = [makeViolation()]
      const silentPattern = silent(/nonexistent/)
      applyFilters(violations, {
        exclusions: [silentPattern.pattern],
        silentIndices: new Set([0]),
        metadata: { id: 'test-rule' },
      })
      expect(console.warn).not.toHaveBeenCalled()
    })

    it('non-silent exclusion matching nothing still warns', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const violations = [makeViolation()]
      applyFilters(violations, {
        exclusions: [/nonexistent/],
        silentIndices: new Set(),
        metadata: { id: 'test-rule' },
      })
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Unused exclusion'))
    })

    it('mixed silent and non-silent: only non-silent warns', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const violations = [makeViolation()]
      // Index 0 = silent (no match), Index 1 = non-silent (no match)
      applyFilters(violations, {
        exclusions: [/\.d\.ts$/, /also-nonexistent/],
        silentIndices: new Set([0]),
        metadata: { id: 'test-rule' },
      })
      // Only the non-silent pattern should trigger a warning
      expect(console.warn).toHaveBeenCalledTimes(1)
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('also-nonexistent'))
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
})
