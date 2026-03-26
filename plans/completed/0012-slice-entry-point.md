# Plan 0012: Slice Entry Point & Cycle/Layer Conditions

## Status

- **State:** Complete
- **Priority:** P1 — Enables architectural boundary enforcement at the module-group level
- **Effort:** 2-3 days
- **Created:** 2026-03-26
- **Depends on:** 0002 (Project Loader), 0005 (Rule Builder), 0007 (Module Entry Point — import resolution patterns)

## Purpose

Implement the `slices(p)` entry point that groups source files into logical units (slices) by path patterns and enforces dependency constraints between them. This covers spec sections 5.7 and 6.6.

Where `modules(p)` operates on individual source files, `slices(p)` operates on groups of files. This enables three high-value architectural rules:

1. **Cycle-free slices** — no circular dependencies between feature modules
2. **Layer ordering** — presentation may call application but not vice versa
3. **Slice isolation** — named slices must not depend on other named slices

```typescript
// Cycle detection across feature modules
slices(project)
  .matching('src/features/*/')
  .should().beFreeOfCycles()
  .check()

// Layered architecture enforcement
const layers = {
  presentation: 'src/controllers/**',
  application: 'src/services/**',
  persistence: 'src/repositories/**',
  domain: 'src/domain/**',
}
slices(project)
  .assignedFrom(layers)
  .should().respectLayerOrder('presentation', 'application', 'persistence', 'domain')
  .because('layers must not depend upward')
  .check()
```

### Design Decision: Slice as a Lightweight Value Object

A `Slice` is a simple `{ name, files }` pair — not a class. Slice resolution happens once when `matching()` or `assignedFrom()` is called, producing `Slice[]` that the builder and conditions operate on. This avoids re-resolving globs on every condition evaluation.

### Design Decision: SliceRuleBuilder Does Not Extend RuleBuilder

`RuleBuilder<T>` assumes individual elements filtered by predicates, then checked by conditions. Slices are different: the grouping step (`matching` / `assignedFrom`) replaces the predicate phase entirely, and conditions operate on the full slice graph rather than individual elements. `SliceRuleBuilder` implements its own `should()` / `check()` / `warn()` / `because()` chain rather than inheriting from `RuleBuilder`. This avoids awkward type gymnastics (`RuleBuilder<Slice>` would require `getElements()` to return slices, but predicates like `resideInFolder` make no sense on slices).

### Design Decision: Tarjan's SCC as a Pure Helper

The cycle detection algorithm is a pure function `tarjanSCC(graph) => number[][]` with no domain knowledge. It takes an adjacency list and returns strongly connected components. This makes it independently testable and reusable (e.g., for future circular import detection at the file level).

## Phase 1: Slice Model & Resolution

### `src/models/slice.ts`

```typescript
import picomatch from 'picomatch'
import type { SourceFile } from 'ts-morph'
import type { ArchProject } from '../core/project.js'

/**
 * A slice groups source files into a logical unit.
 * Slices are the nodes in the slice dependency graph.
 */
export interface Slice {
  /** Slice name — directory name for matching(), key name for assignedFrom() */
  readonly name: string
  /** Source files belonging to this slice */
  readonly files: SourceFile[]
}

/**
 * A mapping of slice names to glob patterns.
 * Used by `assignedFrom()` to define slices explicitly.
 *
 * @example
 * const layers: SliceDefinition = {
 *   presentation: 'src/controllers/**',
 *   application: 'src/services/**',
 *   domain: 'src/domain/**',
 * }
 */
export type SliceDefinition = Record<string, string>

/**
 * Resolve slices by matching a glob pattern against source file paths.
 * Each unique directory matching the glob becomes a slice.
 *
 * The glob must contain a wildcard segment that distinguishes slices.
 * For example, 'src/features/*\/' matches each subdirectory of src/features/
 * as a separate slice.
 *
 * @param project - The loaded ArchProject
 * @param glob - A glob pattern where the wildcard segment defines slice boundaries
 * @returns Array of slices, one per matching directory
 *
 * @example
 * resolveByMatching(project, 'src/features/*\/')
 * // => [{ name: 'auth', files: [...] }, { name: 'billing', files: [...] }]
 */
export function resolveByMatching(project: ArchProject, glob: string): Slice[] {
  const isMatch = picomatch(glob + '**')
  const sourceFiles = project.getSourceFiles()
  const sliceMap = new Map<string, SourceFile[]>()

  // Extract the base path (everything before the first wildcard)
  const basePath = glob.replace(/\*.*$/, '')

  for (const sf of sourceFiles) {
    const filePath = sf.getFilePath()
    if (!isMatch(filePath)) continue

    // Extract the slice name: the directory segment matching the wildcard
    const relativePart = filePath.slice(filePath.indexOf(basePath) + basePath.length)
    const sliceName = relativePart.split('/')[0]
    if (!sliceName) continue

    const existing = sliceMap.get(sliceName)
    if (existing) {
      existing.push(sf)
    } else {
      sliceMap.set(sliceName, [sf])
    }
  }

  return Array.from(sliceMap.entries()).map(([name, files]) => ({ name, files }))
}

/**
 * Resolve slices from an explicit name-to-glob mapping.
 * Each key becomes a slice name, and files matching its glob are assigned to it.
 *
 * A file matching multiple globs is assigned to the FIRST matching slice.
 * Files matching no glob are excluded from all slices.
 *
 * @param project - The loaded ArchProject
 * @param definition - Map of slice names to glob patterns
 * @returns Array of slices in definition key order
 *
 * @example
 * resolveByDefinition(project, {
 *   presentation: 'src/controllers/**',
 *   domain: 'src/domain/**',
 * })
 */
export function resolveByDefinition(
  project: ArchProject,
  definition: SliceDefinition,
): Slice[] {
  const sourceFiles = project.getSourceFiles()
  const entries = Object.entries(definition)
  const matchers = entries.map(([name, glob]) => ({
    name,
    isMatch: picomatch(glob),
    files: [] as SourceFile[],
  }))

  for (const sf of sourceFiles) {
    const filePath = sf.getFilePath()
    for (const matcher of matchers) {
      if (matcher.isMatch(filePath)) {
        matcher.files.push(sf)
        break // first match wins
      }
    }
  }

  return matchers.map(({ name, files }) => ({ name, files }))
}
```

## Phase 2: Tarjan's SCC Algorithm

### `src/helpers/tarjan.ts`

```typescript
/**
 * An adjacency list representation of a directed graph.
 * Keys are node indices, values are arrays of neighbor indices.
 */
export type AdjacencyList = Map<number, number[]>

/**
 * Find all strongly connected components in a directed graph
 * using Tarjan's algorithm.
 *
 * Returns only components with size > 1 (i.e., actual cycles).
 * Each component is an array of node indices forming a cycle.
 *
 * Time complexity: O(V + E)
 * Space complexity: O(V)
 *
 * @param nodeCount - Total number of nodes (0-indexed)
 * @param edges - Adjacency list: node index -> list of neighbor indices
 * @returns Array of strongly connected components (size > 1)
 */
export function tarjanSCC(nodeCount: number, edges: AdjacencyList): number[][] {
  const index = new Array<number>(nodeCount).fill(-1)
  const lowlink = new Array<number>(nodeCount).fill(-1)
  const onStack = new Array<boolean>(nodeCount).fill(false)
  const stack: number[] = []
  let currentIndex = 0
  const sccs: number[][] = []

  function strongConnect(v: number): void {
    index[v] = currentIndex
    lowlink[v] = currentIndex
    currentIndex++
    stack.push(v)
    onStack[v] = true

    const neighbors = edges.get(v) ?? []
    for (const w of neighbors) {
      if (index[w] === -1) {
        // w has not been visited
        strongConnect(w)
        lowlink[v] = Math.min(lowlink[v], lowlink[w])
      } else if (onStack[w]) {
        // w is on the stack, so it's in the current SCC
        lowlink[v] = Math.min(lowlink[v], index[w])
      }
    }

    // If v is a root node, pop the SCC
    if (lowlink[v] === index[v]) {
      const scc: number[] = []
      let w: number
      do {
        w = stack.pop()!
        onStack[w] = false
        scc.push(w)
      } while (w !== v)

      // Only report cycles (size > 1)
      if (scc.length > 1) {
        sccs.push(scc)
      }
    }
  }

  for (let v = 0; v < nodeCount; v++) {
    if (index[v] === -1) {
      strongConnect(v)
    }
  }

  return sccs
}
```

## Phase 3: Slice Dependency Graph Builder

### `src/helpers/slice-graph.ts`

```typescript
import type { SourceFile } from 'ts-morph'
import type { Slice } from '../models/slice.js'

/**
 * An edge in the slice dependency graph.
 * Represents: a file in `from` imports a file in `to`.
 */
export interface SliceEdge {
  from: string
  to: string
}

/**
 * Build a directed dependency graph between slices.
 *
 * For each file in each slice, resolve its imports. If an imported file
 * belongs to a different slice, add a directed edge from the importing
 * slice to the imported slice.
 *
 * @param slices - The resolved slices
 * @returns Unique directed edges between slices
 */
export function buildSliceDependencyGraph(slices: Slice[]): SliceEdge[] {
  // Build a reverse lookup: file path -> slice name
  const fileToSlice = new Map<string, string>()
  for (const slice of slices) {
    for (const file of slice.files) {
      fileToSlice.set(file.getFilePath(), slice.name)
    }
  }

  // Collect unique edges
  const edgeSet = new Set<string>()
  const edges: SliceEdge[] = []

  for (const slice of slices) {
    for (const file of slice.files) {
      for (const importDecl of file.getImportDeclarations()) {
        const resolved = importDecl.getModuleSpecifierSourceFile()
        if (!resolved) continue

        const targetSlice = fileToSlice.get(resolved.getFilePath())
        if (targetSlice && targetSlice !== slice.name) {
          const edgeKey = `${slice.name}->${targetSlice}`
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey)
            edges.push({ from: slice.name, to: targetSlice })
          }
        }
      }
    }
  }

  return edges
}

/**
 * Find which specific files cause a dependency from one slice to another.
 * Used for detailed violation messages.
 *
 * @returns Array of { sourceFile, importPath, fromSlice, toSlice }
 */
export function findSliceDependencyDetails(
  slices: Slice[],
  fromSliceName: string,
  toSliceName: string,
): Array<{ sourceFile: SourceFile; importPath: string }> {
  const fileToSlice = new Map<string, string>()
  for (const slice of slices) {
    for (const file of slice.files) {
      fileToSlice.set(file.getFilePath(), slice.name)
    }
  }

  const fromSlice = slices.find((s) => s.name === fromSliceName)
  if (!fromSlice) return []

  const details: Array<{ sourceFile: SourceFile; importPath: string }> = []
  for (const file of fromSlice.files) {
    for (const importDecl of file.getImportDeclarations()) {
      const resolved = importDecl.getModuleSpecifierSourceFile()
      if (!resolved) continue

      const targetSlice = fileToSlice.get(resolved.getFilePath())
      if (targetSlice === toSliceName) {
        details.push({
          sourceFile: file,
          importPath: resolved.getFilePath(),
        })
      }
    }
  }

  return details
}
```

## Phase 4: Slice Conditions

### `src/conditions/slice.ts`

```typescript
import type { Condition, ConditionContext } from '../core/condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { Slice } from '../models/slice.js'
import { buildSliceDependencyGraph, findSliceDependencyDetails } from '../helpers/slice-graph.js'
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
      const edges = buildSliceDependencyGraph(slices)

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
        const fromSlice = cycleNames[0]
        const toSlice = cycleNames[1] ?? cycleNames[0]
        const details = findSliceDependencyDetails(slices, fromSlice, toSlice)
        const firstDetail = details[0]

        violations.push({
          rule: context.rule,
          element: `[${cycleNames.join(', ')}]`,
          file: firstDetail ? firstDetail.sourceFile.getFilePath() : 'unknown',
          line: firstDetail ? firstDetail.sourceFile.getStartLineNumber() : 0,
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
      const edges = buildSliceDependencyGraph(slices)

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
          const details = findSliceDependencyDetails(slices, edge.from, edge.to)
          for (const detail of details) {
            violations.push({
              rule: context.rule,
              element: detail.sourceFile.getBaseName(),
              file: detail.sourceFile.getFilePath(),
              line: detail.sourceFile.getStartLineNumber(),
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
      const edges = buildSliceDependencyGraph(slices)

      const violations: ArchViolation[] = []

      for (const edge of edges) {
        if (forbiddenSet.has(edge.to)) {
          const details = findSliceDependencyDetails(slices, edge.from, edge.to)
          for (const detail of details) {
            violations.push({
              rule: context.rule,
              element: detail.sourceFile.getBaseName(),
              file: detail.sourceFile.getFilePath(),
              line: detail.sourceFile.getStartLineNumber(),
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
```

## Phase 5: SliceRuleBuilder

### `src/builders/slice-rule-builder.ts`

```typescript
import type { ArchProject } from '../core/project.js'
import type { ArchViolation } from '../core/violation.js'
import type { Condition, ConditionContext } from '../core/condition.js'
import { ArchRuleError } from '../core/errors.js'
import type { Slice, SliceDefinition } from '../models/slice.js'
import { resolveByMatching, resolveByDefinition } from '../models/slice.js'
import {
  beFreeOfCycles as beFreeOfCyclesCondition,
  respectLayerOrder as respectLayerOrderCondition,
  notDependOn as notDependOnCondition,
} from '../conditions/slice.js'

/**
 * Rule builder for slice-level architecture rules.
 *
 * Unlike other builders that extend RuleBuilder<T>, SliceRuleBuilder
 * has its own chain because the grouping step (matching/assignedFrom)
 * replaces the predicate phase entirely.
 *
 * Usage:
 *   slices(project).matching(glob).should().beFreeOfCycles().check()
 *   slices(project).assignedFrom(def).should().respectLayerOrder(...).check()
 */
export class SliceRuleBuilder {
  private _slices: Slice[] = []
  private _conditions: Condition<Slice>[] = []
  private _reason?: string

  constructor(private readonly project: ArchProject) {}

  /**
   * Define slices by glob matching. Each directory matching the glob
   * becomes a slice named after that directory.
   *
   * @param glob - A glob pattern where the wildcard segment identifies slices
   *
   * @example
   * slices(project).matching('src/features/*\/')
   * // Slices: auth, billing, orders, etc.
   */
  matching(glob: string): this {
    this._slices = resolveByMatching(this.project, glob)
    return this
  }

  /**
   * Define slices from an explicit name-to-glob mapping.
   *
   * @param definition - Map of slice names to glob patterns
   *
   * @example
   * slices(project).assignedFrom({
   *   presentation: 'src/controllers/**',
   *   domain: 'src/domain/**',
   * })
   */
  assignedFrom(definition: SliceDefinition): this {
    this._slices = resolveByDefinition(this.project, definition)
    return this
  }

  /**
   * Begin the condition phase. Returns `this` for chaining.
   */
  should(): this {
    return this
  }

  /**
   * Add another condition (AND).
   */
  andShould(): this {
    return this
  }

  /**
   * Assert that no circular dependencies exist between slices.
   */
  beFreeOfCycles(): this {
    this._conditions.push(beFreeOfCyclesCondition())
    return this
  }

  /**
   * Assert that slices respect a layered dependency order.
   * Layer N may depend on layers N+1, N+2, ... but NOT on layers with lower index.
   *
   * @param layers - Ordered layer names from highest to lowest
   */
  respectLayerOrder(...layers: string[]): this {
    this._conditions.push(respectLayerOrderCondition(...layers))
    return this
  }

  /**
   * Assert that no slice depends on any of the listed slices.
   *
   * @param sliceNames - Names of forbidden dependency targets
   */
  notDependOn(...sliceNames: string[]): this {
    this._conditions.push(notDependOnCondition(...sliceNames))
    return this
  }

  /**
   * Attach a human-readable rationale to the rule.
   */
  because(reason: string): this {
    this._reason = reason
    return this
  }

  /**
   * Execute the rule and throw `ArchRuleError` if any violations are found.
   */
  check(): void {
    const violations = this.evaluate()
    if (violations.length > 0) {
      throw new ArchRuleError(violations, this._reason)
    }
  }

  /**
   * Execute the rule and log violations to stderr. Does not throw.
   */
  warn(): void {
    const violations = this.evaluate()
    if (violations.length > 0) {
      const formatted = violations
        .map((v) => `  - ${v.element}: ${v.message} (${v.file}:${String(v.line)})`)
        .join('\n')
      const reasonLine = this._reason ? `\nReason: ${this._reason}` : ''
      console.warn(
        `Architecture warning${violations.length === 1 ? '' : 's'} (${String(violations.length)} found)${reasonLine}\n${formatted}`,
      )
    }
  }

  /**
   * Execute the rule with the given severity.
   */
  severity(level: 'error' | 'warn'): void {
    if (level === 'error') {
      this.check()
    } else {
      this.warn()
    }
  }

  private evaluate(): ArchViolation[] {
    if (this._slices.length === 0 || this._conditions.length === 0) {
      return []
    }

    const context: ConditionContext = {
      rule: this.buildRuleDescription(),
      because: this._reason,
    }

    const violations: ArchViolation[] = []
    for (const condition of this._conditions) {
      violations.push(...condition.evaluate(this._slices, context))
    }
    return violations
  }

  private buildRuleDescription(): string {
    const sliceDesc = this._slices.map((s) => s.name).join(', ')
    const conditionDesc = this._conditions.map((c) => c.description).join(' and ')
    return `slices [${sliceDesc}] should ${conditionDesc}`
  }
}

/**
 * Entry point: create a slice-level rule builder.
 *
 * @param p - The loaded ArchProject
 * @returns A SliceRuleBuilder — call `.matching()` or `.assignedFrom()` next
 *
 * @example
 * slices(project)
 *   .matching('src/features/*\/')
 *   .should().beFreeOfCycles()
 *   .check()
 */
export function slices(p: ArchProject): SliceRuleBuilder {
  return new SliceRuleBuilder(p)
}
```

## Phase 6: Test Fixtures

### `tests/fixtures/slices/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

### `tests/fixtures/slices/src/domain/entity.ts`

```typescript
export interface Entity {
  id: string
}
```

### `tests/fixtures/slices/src/domain/value-object.ts`

```typescript
export interface ValueObject {
  equals(other: unknown): boolean
}
```

### `tests/fixtures/slices/src/services/order-service.ts`

```typescript
import type { Entity } from '../domain/entity.js'

export function createOrder(id: string): Entity {
  return { id }
}
```

### `tests/fixtures/slices/src/controllers/order-controller.ts`

```typescript
import { createOrder } from '../services/order-service.js'

export function handleCreateOrder(): void {
  createOrder('1')
}
```

### `tests/fixtures/slices/src/bad/leaky-controller.ts`

A "bad" module that violates layer order by having controllers depend on it while it depends back on controllers:

```typescript
import { handleCreateOrder } from '../controllers/order-controller.js'

export function badInit(): void {
  handleCreateOrder()
}
```

### `tests/fixtures/slices/src/feature-a/index.ts`

```typescript
import { helperB } from '../feature-b/helper.js'

export function featureA(): string {
  return helperB()
}
```

### `tests/fixtures/slices/src/feature-b/helper.ts`

```typescript
import { featureA } from '../feature-a/index.js'

export function helperB(): string {
  return featureA()
}
```

This creates a cycle: `feature-a -> feature-b -> feature-a`.

### `tests/fixtures/slices/src/feature-c/standalone.ts`

A standalone feature with no cross-feature dependencies (for negative tests):

```typescript
export function featureC(): string {
  return 'standalone'
}
```

## Phase 7: Tests

### `tests/helpers/tarjan.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { tarjanSCC, type AdjacencyList } from '../../src/helpers/tarjan.js'

describe('tarjanSCC', () => {
  it('returns empty for a DAG (no cycles)', () => {
    // 0 -> 1 -> 2
    const edges: AdjacencyList = new Map([
      [0, [1]],
      [1, [2]],
    ])
    const sccs = tarjanSCC(3, edges)
    expect(sccs).toHaveLength(0)
  })

  it('detects a simple two-node cycle', () => {
    // 0 -> 1 -> 0
    const edges: AdjacencyList = new Map([
      [0, [1]],
      [1, [0]],
    ])
    const sccs = tarjanSCC(2, edges)
    expect(sccs).toHaveLength(1)
    expect(sccs[0]).toHaveLength(2)
    expect(sccs[0]).toContain(0)
    expect(sccs[0]).toContain(1)
  })

  it('detects a three-node cycle', () => {
    // 0 -> 1 -> 2 -> 0
    const edges: AdjacencyList = new Map([
      [0, [1]],
      [1, [2]],
      [2, [0]],
    ])
    const sccs = tarjanSCC(3, edges)
    expect(sccs).toHaveLength(1)
    expect(sccs[0]).toHaveLength(3)
  })

  it('detects multiple independent cycles', () => {
    // Cycle 1: 0 <-> 1, Cycle 2: 2 <-> 3
    const edges: AdjacencyList = new Map([
      [0, [1]],
      [1, [0]],
      [2, [3]],
      [3, [2]],
    ])
    const sccs = tarjanSCC(4, edges)
    expect(sccs).toHaveLength(2)
  })

  it('ignores self-loops (size-1 SCC)', () => {
    // 0 -> 0 (self-loop)
    const edges: AdjacencyList = new Map([[0, [0]]])
    const sccs = tarjanSCC(1, edges)
    // Self-loops are SCCs of size 1 — filtered out
    expect(sccs).toHaveLength(0)
  })

  it('handles disconnected graph with no cycles', () => {
    const edges: AdjacencyList = new Map()
    const sccs = tarjanSCC(5, edges)
    expect(sccs).toHaveLength(0)
  })

  it('handles a complex graph with one cycle and acyclic branches', () => {
    // 0 -> 1 -> 2 -> 1 (cycle), 0 -> 3 (acyclic)
    const edges: AdjacencyList = new Map([
      [0, [1, 3]],
      [1, [2]],
      [2, [1]],
    ])
    const sccs = tarjanSCC(4, edges)
    expect(sccs).toHaveLength(1)
    expect(sccs[0]).toContain(1)
    expect(sccs[0]).toContain(2)
    expect(sccs[0]).not.toContain(0)
  })
})
```

### `tests/models/slice.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { resolveByMatching, resolveByDefinition } from '../../src/models/slice.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/slices')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('resolveByMatching', () => {
  const p = loadTestProject()

  it('creates slices from directories matching the glob', () => {
    const result = resolveByMatching(p, 'src/feature-')
    const names = result.map((s) => s.name).sort()
    expect(names).toContain('feature-a')
    expect(names).toContain('feature-b')
    expect(names).toContain('feature-c')
  })

  it('assigns files to the correct slice', () => {
    const result = resolveByMatching(p, 'src/feature-')
    const featureA = result.find((s) => s.name === 'feature-a')
    expect(featureA).toBeDefined()
    expect(featureA!.files.length).toBeGreaterThan(0)
    expect(featureA!.files.some((f) => f.getBaseName() === 'index.ts')).toBe(true)
  })

  it('returns empty array when no directories match', () => {
    const result = resolveByMatching(p, 'src/nonexistent-*/')
    expect(result).toHaveLength(0)
  })
})

describe('resolveByDefinition', () => {
  const p = loadTestProject()

  it('creates slices from explicit definitions', () => {
    const result = resolveByDefinition(p, {
      domain: '**/domain/**',
      services: '**/services/**',
      controllers: '**/controllers/**',
    })
    expect(result).toHaveLength(3)
    expect(result.map((s) => s.name)).toEqual(['domain', 'services', 'controllers'])
  })

  it('assigns files matching the glob to the correct slice', () => {
    const result = resolveByDefinition(p, {
      domain: '**/domain/**',
    })
    const domain = result[0]
    expect(domain.files.length).toBe(2) // entity.ts and value-object.ts
  })

  it('first match wins for overlapping globs', () => {
    const result = resolveByDefinition(p, {
      all: '**/*.ts',
      domain: '**/domain/**',
    })
    // domain files should go to 'all' (first match)
    const domain = result.find((s) => s.name === 'domain')!
    expect(domain.files).toHaveLength(0)
  })
})
```

### `tests/conditions/slice.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { beFreeOfCycles, respectLayerOrder, notDependOn } from '../../src/conditions/slice.js'
import { resolveByMatching, resolveByDefinition } from '../../src/models/slice.js'
import type { ArchProject } from '../../src/core/project.js'
import type { ConditionContext } from '../../src/core/condition.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/slices')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

const ctx: ConditionContext = { rule: 'test rule' }

describe('beFreeOfCycles', () => {
  const p = loadTestProject()

  it('detects cycles between feature slices', () => {
    const featureSlices = resolveByMatching(p, 'src/feature-')
    const condition = beFreeOfCycles()
    const violations = condition.evaluate(featureSlices, ctx)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.some((v) => v.message.includes('Cycle detected'))).toBe(true)
    expect(violations.some((v) => v.message.includes('feature-a'))).toBe(true)
    expect(violations.some((v) => v.message.includes('feature-b'))).toBe(true)
  })

  it('passes when there are no cycles', () => {
    const layerSlices = resolveByDefinition(p, {
      domain: '**/domain/**',
      services: '**/services/**',
    })
    const condition = beFreeOfCycles()
    const violations = condition.evaluate(layerSlices, ctx)
    expect(violations).toHaveLength(0)
  })
})

describe('respectLayerOrder', () => {
  const p = loadTestProject()

  it('passes when dependencies flow downward', () => {
    const layerSlices = resolveByDefinition(p, {
      controllers: '**/controllers/**',
      services: '**/services/**',
      domain: '**/domain/**',
    })
    const condition = respectLayerOrder('controllers', 'services', 'domain')
    const violations = condition.evaluate(layerSlices, ctx)
    expect(violations).toHaveLength(0)
  })

  it('reports violations when a lower layer depends on a higher layer', () => {
    const layerSlices = resolveByDefinition(p, {
      controllers: '**/controllers/**',
      services: '**/services/**',
      domain: '**/domain/**',
      bad: '**/bad/**',
    })
    // bad imports from controllers; if bad is placed below controllers, it violates
    const condition = respectLayerOrder('bad', 'controllers', 'services', 'domain')
    const violations = condition.evaluate(layerSlices, ctx)
    // controllers -> services is fine, but bad is above controllers and depends on it
    // Actually, bad depends on controllers, and bad is at index 0 (above controllers at index 1)
    // So bad -> controllers is downward (0 -> 1), which is allowed
    // Let's reverse: put bad below controllers
    const condition2 = respectLayerOrder('controllers', 'services', 'domain', 'bad')
    const violations2 = condition2.evaluate(layerSlices, ctx)
    // bad (index 3) depends on controllers (index 0) — upward, violation
    expect(violations2.length).toBeGreaterThan(0)
    expect(violations2.some((v) => v.message.includes('bad'))).toBe(true)
    expect(violations2.some((v) => v.message.includes('controllers'))).toBe(true)
  })
})

describe('notDependOn', () => {
  const p = loadTestProject()

  it('passes when no slice depends on the forbidden slice', () => {
    const layerSlices = resolveByDefinition(p, {
      domain: '**/domain/**',
      services: '**/services/**',
    })
    const condition = notDependOn('controllers')
    const violations = condition.evaluate(layerSlices, ctx)
    expect(violations).toHaveLength(0)
  })

  it('reports violations when a slice depends on a forbidden slice', () => {
    const layerSlices = resolveByDefinition(p, {
      bad: '**/bad/**',
      controllers: '**/controllers/**',
    })
    const condition = notDependOn('controllers')
    const violations = condition.evaluate(layerSlices, ctx)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.some((v) => v.message.includes('forbidden slice "controllers"'))).toBe(true)
  })
})
```

### `tests/builders/slice-rule-builder.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import path from 'node:path'
import { slices, SliceRuleBuilder } from '../../src/builders/slice-rule-builder.js'
import { ArchRuleError } from '../../src/core/errors.js'
import type { ArchProject } from '../../src/core/project.js'

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/slices')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')

function loadTestProject(): ArchProject {
  const tsMorphProject = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: tsMorphProject,
    getSourceFiles: () => tsMorphProject.getSourceFiles(),
  }
}

describe('slices() entry point', () => {
  const p = loadTestProject()

  it('returns a SliceRuleBuilder', () => {
    expect(slices(p)).toBeInstanceOf(SliceRuleBuilder)
  })
})

describe('SliceRuleBuilder with matching()', () => {
  const p = loadTestProject()

  it('detects cycles between feature slices', () => {
    expect(() => {
      slices(p)
        .matching('src/feature-')
        .should().beFreeOfCycles()
        .check()
    }).toThrow(ArchRuleError)
  })

  it('passes beFreeOfCycles when slices are acyclic', () => {
    expect(() => {
      slices(p)
        .matching('src/feature-c')
        .should().beFreeOfCycles()
        .check()
    }).not.toThrow()
  })
})

describe('SliceRuleBuilder with assignedFrom()', () => {
  const p = loadTestProject()

  it('passes respectLayerOrder when dependencies flow correctly', () => {
    expect(() => {
      slices(p)
        .assignedFrom({
          controllers: '**/controllers/**',
          services: '**/services/**',
          domain: '**/domain/**',
        })
        .should().respectLayerOrder('controllers', 'services', 'domain')
        .check()
    }).not.toThrow()
  })

  it('fails respectLayerOrder when a lower layer depends upward', () => {
    expect(() => {
      slices(p)
        .assignedFrom({
          controllers: '**/controllers/**',
          services: '**/services/**',
          domain: '**/domain/**',
          bad: '**/bad/**',
        })
        .should().respectLayerOrder('controllers', 'services', 'domain', 'bad')
        .check()
    }).toThrow(ArchRuleError)
  })

  it('passes notDependOn when no forbidden dependencies exist', () => {
    expect(() => {
      slices(p)
        .assignedFrom({
          domain: '**/domain/**',
          services: '**/services/**',
        })
        .should().notDependOn('controllers')
        .check()
    }).not.toThrow()
  })

  it('fails notDependOn when forbidden dependencies exist', () => {
    expect(() => {
      slices(p)
        .assignedFrom({
          bad: '**/bad/**',
          controllers: '**/controllers/**',
        })
        .should().notDependOn('controllers')
        .check()
    }).toThrow(ArchRuleError)
  })
})

describe('SliceRuleBuilder chain methods', () => {
  const p = loadTestProject()

  it('.because() includes reason in error', () => {
    try {
      slices(p)
        .matching('src/feature-')
        .should().beFreeOfCycles()
        .because('features must not have circular deps')
        .check()
      expect.unreachable('should have thrown')
    } catch (error) {
      const archError = error as ArchRuleError
      expect(archError.message).toContain('features must not have circular deps')
    }
  })

  it('.warn() does not throw', () => {
    expect(() => {
      slices(p)
        .matching('src/feature-')
        .should().beFreeOfCycles()
        .warn()
    }).not.toThrow()
  })

  it('.severity("error") throws on violations', () => {
    expect(() => {
      slices(p)
        .matching('src/feature-')
        .should().beFreeOfCycles()
        .severity('error')
    }).toThrow(ArchRuleError)
  })

  it('.severity("warn") does not throw', () => {
    expect(() => {
      slices(p)
        .matching('src/feature-')
        .should().beFreeOfCycles()
        .severity('warn')
    }).not.toThrow()
  })

  it('supports multiple conditions with andShould()', () => {
    expect(() => {
      slices(p)
        .assignedFrom({
          controllers: '**/controllers/**',
          services: '**/services/**',
          domain: '**/domain/**',
        })
        .should().respectLayerOrder('controllers', 'services', 'domain')
        .andShould().beFreeOfCycles()
        .check()
    }).not.toThrow()
  })
})
```

## Phase 8: Public API Export

### `src/index.ts` additions

```typescript
// Slice model
export type { Slice, SliceDefinition } from './models/slice.js'

// Slice conditions
export { beFreeOfCycles, respectLayerOrder, notDependOn } from './conditions/slice.js'

// Slice entry point
export { slices, SliceRuleBuilder } from './builders/slice-rule-builder.js'
```

## Files Changed

| File | Change |
|------|--------|
| `src/models/slice.ts` | New — `Slice` interface, `SliceDefinition` type, `resolveByMatching`, `resolveByDefinition` |
| `src/helpers/tarjan.ts` | New — Tarjan's SCC algorithm, `AdjacencyList` type |
| `src/helpers/slice-graph.ts` | New — `buildSliceDependencyGraph`, `findSliceDependencyDetails` |
| `src/conditions/slice.ts` | New — `beFreeOfCycles`, `respectLayerOrder`, `notDependOn` conditions |
| `src/builders/slice-rule-builder.ts` | New — `SliceRuleBuilder` class + `slices()` entry function |
| `src/index.ts` | Modified — export slice types, conditions, and `slices()` entry point |
| `tests/fixtures/slices/` | New — fixture project with domain/services/controllers/bad/feature-a/feature-b/feature-c |
| `tests/helpers/tarjan.test.ts` | New — 7 tests for Tarjan's SCC algorithm |
| `tests/models/slice.test.ts` | New — 6 tests for slice resolution |
| `tests/conditions/slice.test.ts` | New — 6 tests for slice conditions |
| `tests/builders/slice-rule-builder.test.ts` | New — 12 tests for builder + entry point |

## Test Inventory

| # | Test | What it validates |
|---|------|-------------------|
| 1 | `tarjanSCC` returns empty for a DAG | No false positives on acyclic graphs |
| 2 | `tarjanSCC` detects a two-node cycle | Basic cycle detection |
| 3 | `tarjanSCC` detects a three-node cycle | Multi-node cycle |
| 4 | `tarjanSCC` detects multiple independent cycles | Multiple SCCs |
| 5 | `tarjanSCC` ignores self-loops | Size-1 SCCs filtered |
| 6 | `tarjanSCC` handles disconnected graph | Edge case: no edges |
| 7 | `tarjanSCC` handles mixed cycle + acyclic branches | Partial graph cycle |
| 8 | `resolveByMatching` creates slices from directories | Glob-based slice discovery |
| 9 | `resolveByMatching` assigns files to correct slice | File-to-slice mapping |
| 10 | `resolveByMatching` returns empty for no matches | Negative case |
| 11 | `resolveByDefinition` creates slices from explicit defs | Definition-based slices |
| 12 | `resolveByDefinition` assigns files correctly | File counting per slice |
| 13 | `resolveByDefinition` first match wins | Overlap resolution |
| 14 | `beFreeOfCycles` detects cycles between features | Cycle condition: fail |
| 15 | `beFreeOfCycles` passes for acyclic slices | Cycle condition: pass |
| 16 | `respectLayerOrder` passes for correct layer flow | Layer condition: pass |
| 17 | `respectLayerOrder` detects upward dependency | Layer condition: fail |
| 18 | `notDependOn` passes when no forbidden deps | Isolation condition: pass |
| 19 | `notDependOn` detects forbidden dependency | Isolation condition: fail |
| 20 | `slices()` returns SliceRuleBuilder | Entry point type |
| 21 | `matching()` + `beFreeOfCycles` detects cycles | End-to-end: cycle |
| 22 | `matching()` + `beFreeOfCycles` passes for acyclic | End-to-end: no cycle |
| 23 | `assignedFrom()` + `respectLayerOrder` passes | End-to-end: layers pass |
| 24 | `assignedFrom()` + `respectLayerOrder` fails | End-to-end: layers fail |
| 25 | `assignedFrom()` + `notDependOn` passes | End-to-end: isolation pass |
| 26 | `assignedFrom()` + `notDependOn` fails | End-to-end: isolation fail |
| 27 | `.because()` includes reason in error | Rationale wiring |
| 28 | `.warn()` does not throw | Warn terminal method |
| 29 | `.severity('error')` throws | Severity: error |
| 30 | `.severity('warn')` does not throw | Severity: warn |
| 31 | Multiple conditions with `.andShould()` | Condition chaining |

## Out of Scope

- **Slice predicates** (filtering which slices to check) — not needed for initial release; all resolved slices are checked. Could add `.that().haveNameMatching()` on slices in a future plan if needed.
- **Weighted or detailed cycle reporting** — the current implementation reports one violation per SCC. Future work could list every edge in the cycle or highlight the "shortest cycle" within an SCC.
- **Dynamic slice resolution** (e.g., monorepo package detection) — `matching()` and `assignedFrom()` cover the common cases. Package-based slicing from `package.json` would be a separate plan.
- **Cross-project / multi-tsconfig slices** — each slice operates within a single `ArchProject`. Multi-project support is a separate concern.
- **Export-boundary conditions** (e.g., "slices may only import via barrel files") — valuable but distinct from dependency direction rules. Deferred to a future plan.
- **`.orShould()` OR conditions** — deferred per plan 0005 decision.
