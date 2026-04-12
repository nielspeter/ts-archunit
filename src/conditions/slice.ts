import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { Slice } from '../models/slice.js'
import {
  buildSliceDependencyGraph,
  buildFileToSliceMap,
  findSliceDependencyDetails,
} from '../helpers/slice-graph.js'
import { tarjanSCC, type AdjacencyList } from '../helpers/tarjan.js'

/**
 * Assert that no circular dependencies exist between slices.
 *
 * Builds a directed dependency graph from import declarations,
 * then runs Tarjan's SCC algorithm to detect cycles.
 * Each cycle produces a violation listing the cycle path.
 *
 * @example
 * slices(project)
 *   .matching('src/features/*\/')
 *   .should().beFreeOfCycles()
 *   .check()
 */
export function beFreeOfCycles(): Condition<Slice> {
  return {
    description: 'be free of cycles',
    evaluate(slices: Slice[], context: ConditionContext): ArchViolation[] {
      const fileToSlice = buildFileToSliceMap(slices)
      const edges = buildSliceDependencyGraph(slices, fileToSlice)

      // Map slice names to indices for Tarjan's
      const sliceNames = slices.map((s) => s.name)
      const nameToIndex = new Map(sliceNames.map((name, i) => [name, i]))

      const adjacency: AdjacencyList = new Map()
      for (const edge of edges) {
        const fromIdx = nameToIndex.get(edge.from)
        const toIdx = nameToIndex.get(edge.to)
        if (fromIdx === undefined || toIdx === undefined) continue

        const existing = adjacency.get(fromIdx)
        if (existing) {
          existing.push(toIdx)
        } else {
          adjacency.set(fromIdx, [toIdx])
        }
      }

      const sccs = tarjanSCC(slices.length, adjacency)

      const violations: ArchViolation[] = []
      for (const scc of sccs) {
        const cycleNames = scc.map((i) => sliceNames[i])
        const cyclePath = [...cycleNames, cycleNames[0]].join(' -> ')

        // Find one concrete file causing the cycle for the violation location
        const fromSlice = cycleNames[0] ?? ''
        const toSlice = cycleNames[1] ?? fromSlice
        const details = findSliceDependencyDetails(slices, fromSlice, toSlice, fileToSlice)
        const firstDetail = details[0]

        violations.push({
          rule: context.rule,
          element: `[${cycleNames.join(', ')}]`,
          file: firstDetail ? firstDetail.sourceFile.getFilePath() : 'unknown',
          line: firstDetail ? firstDetail.importLine : 0,
          message: `Cycle detected: ${cyclePath}`,
          because: context.because,
        })
      }

      return violations
    },
  }
}

/**
 * Assert that slices respect a layered dependency order.
 *
 * Given layers ['presentation', 'application', 'persistence', 'domain'],
 * layer N may depend on layers N+1, N+2, ... but NOT on layers N-1, N-2, ...
 * That is, dependencies must flow downward (toward higher indices) only.
 *
 * A layer not present in the slice set is silently skipped.
 *
 * @param layers - Ordered layer names, from highest (e.g., UI) to lowest (e.g., domain)
 *
 * @example
 * slices(project)
 *   .assignedFrom(layers)
 *   .should().respectLayerOrder('presentation', 'application', 'persistence', 'domain')
 *   .check()
 */
export function respectLayerOrder(...layers: string[]): Condition<Slice> {
  return {
    description: `respect layer order [${layers.join(' -> ')}]`,
    evaluate(slices: Slice[], context: ConditionContext): ArchViolation[] {
      const fileToSlice = buildFileToSliceMap(slices)
      const edges = buildSliceDependencyGraph(slices, fileToSlice)

      // Map layer names to their position (lower index = higher layer)
      const layerIndex = new Map(layers.map((name, i) => [name, i]))

      const violations: ArchViolation[] = []

      for (const edge of edges) {
        const fromIdx = layerIndex.get(edge.from)
        const toIdx = layerIndex.get(edge.to)

        // Skip edges involving non-layer slices
        if (fromIdx === undefined || toIdx === undefined) continue

        // Violation: depending on a higher layer (lower index)
        if (toIdx < fromIdx) {
          const details = findSliceDependencyDetails(slices, edge.from, edge.to, fileToSlice)
          for (const detail of details) {
            violations.push({
              rule: context.rule,
              element: detail.sourceFile.getBaseName(),
              file: detail.sourceFile.getFilePath(),
              line: detail.importLine,
              message: `Layer "${edge.from}" depends on higher layer "${edge.to}" (allowed: ${layers.slice(fromIdx + 1).join(', ') || 'none'})`,
              because: context.because,
            })
          }
        }
      }

      return violations
    },
  }
}

/**
 * Assert that no slice depends on any of the listed slices.
 *
 * Use for explicit isolation rules, e.g., "no slice may depend on legacy".
 *
 * @param forbiddenSlices - Names of slices that must not be depended upon
 *
 * @example
 * slices(project)
 *   .matching('src/features/*\/')
 *   .should().notDependOn('legacy', 'deprecated')
 *   .check()
 */
export function notDependOn(...forbiddenSlices: string[]): Condition<Slice> {
  const forbiddenSet = new Set(forbiddenSlices)
  return {
    description: `not depend on [${forbiddenSlices.join(', ')}]`,
    evaluate(slices: Slice[], context: ConditionContext): ArchViolation[] {
      const fileToSlice = buildFileToSliceMap(slices)
      const edges = buildSliceDependencyGraph(slices, fileToSlice)

      const violations: ArchViolation[] = []

      for (const edge of edges) {
        if (forbiddenSet.has(edge.to)) {
          const details = findSliceDependencyDetails(slices, edge.from, edge.to, fileToSlice)
          for (const detail of details) {
            violations.push({
              rule: context.rule,
              element: detail.sourceFile.getBaseName(),
              file: detail.sourceFile.getFilePath(),
              line: detail.importLine,
              message: `Slice "${edge.from}" depends on forbidden slice "${edge.to}"`,
              because: context.because,
            })
          }
        }
      }

      return violations
    },
  }
}
