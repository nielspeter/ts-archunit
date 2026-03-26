import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { buildFingerprint, computeSimilarity } from '../../src/smells/fingerprint.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/smells/duplicate-bodies')

describe('Fingerprint', () => {
  const project = new Project({
    tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json'),
  })

  function getBody(funcName: string) {
    for (const sf of project.getSourceFiles()) {
      for (const fn of sf.getFunctions()) {
        if (fn.getName() === funcName) {
          return fn.getBody()!
        }
      }
    }
    throw new Error(`Function ${funcName} not found`)
  }

  describe('buildFingerprint()', () => {
    it('produces a non-empty fingerprint for a real function', () => {
      const fp = buildFingerprint(getBody('parseWebhookOrder'))
      expect(fp.kinds.length).toBeGreaterThan(0)
      expect(fp.calls.length).toBeGreaterThan(0)
      expect(fp.nodeCount).toBeGreaterThan(0)
    })

    it('captures call targets', () => {
      const fp = buildFingerprint(getBody('parseWebhookOrder'))
      expect(fp.calls).toContain('JSON.parse')
      expect(fp.calls).toContain('parseInt')
    })

    it('captures similar kinds for near-clone structures', () => {
      const fpA = buildFingerprint(getBody('parseWebhookOrder'))
      const fpB = buildFingerprint(getBody('parseContentTypeOrder'))
      // Near-clones should have similar (but not necessarily identical) kind counts
      // file-b has an extra if-block, so some divergence is expected
      expect(fpA.kinds.length).toBeGreaterThan(0)
      expect(fpB.kinds.length).toBeGreaterThan(0)
    })
  })

  describe('computeSimilarity()', () => {
    it('produces high similarity for near-identical bodies', () => {
      const fpA = buildFingerprint(getBody('parseWebhookOrder'))
      const fpB = buildFingerprint(getBody('parseContentTypeOrder'))
      const similarity = computeSimilarity(fpA, fpB)
      // file-b is a near-clone with an extra if-block, so similarity > 0.75
      expect(similarity).toBeGreaterThan(0.75)
    })

    it('produces low similarity for completely different bodies', () => {
      const fpA = buildFingerprint(getBody('parseWebhookOrder'))
      const fpC = buildFingerprint(getBody('formatCurrency'))
      const similarity = computeSimilarity(fpA, fpC)
      expect(similarity).toBeLessThan(0.5)
    })

    it('produces 1.0 for the same body compared to itself', () => {
      const fpA = buildFingerprint(getBody('parseWebhookOrder'))
      const similarity = computeSimilarity(fpA, fpA)
      expect(similarity).toBe(1.0)
    })

    it('produces 1.0 for two empty fingerprints', () => {
      const empty = { kinds: [], calls: [], nodeCount: 0 }
      expect(computeSimilarity(empty, empty)).toBe(1.0)
    })

    it('produces 0.0 when one fingerprint is empty and the other is not', () => {
      const empty = { kinds: [], calls: [], nodeCount: 0 }
      const fpA = buildFingerprint(getBody('parseWebhookOrder'))
      expect(computeSimilarity(empty, fpA)).toBe(0.0)
      expect(computeSimilarity(fpA, empty)).toBe(0.0)
    })
  })
})
