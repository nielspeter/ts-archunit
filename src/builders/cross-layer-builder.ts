import picomatch from 'picomatch'
import type { SourceFile } from 'ts-morph'
import type { ArchProject } from '../core/project.js'
import type { PairCondition } from '../core/pair-condition.js'
import type { ArchViolation } from '../core/violation.js'
import type { ConditionContext } from '../core/condition.js'
import type { CheckOptions } from '../core/check-options.js'
import type { RuleMetadata } from '../core/rule-metadata.js'
import type { Layer, LayerPair } from '../models/cross-layer.js'
import { ArchRuleError } from '../core/errors.js'
import { formatViolations } from '../core/format.js'
import { formatViolationsJson } from '../core/format-json.js'
import { formatViolationsGitHub } from '../core/format-github.js'

/**
 * Resolve a layer by matching its glob against the project's source files.
 */
function resolveLayer(project: ArchProject, name: string, pattern: string): Layer {
  const isMatch = picomatch(pattern)
  const files: SourceFile[] = []
  for (const sf of project.getSourceFiles()) {
    if (isMatch(sf.getFilePath())) {
      files.push(sf)
    }
  }
  return { name, pattern, files }
}

/**
 * Compute matched pairs between two layers using a mapping function.
 * Iterates the Cartesian product, keeping only pairs where the mapping returns true.
 */
function computePairs(
  leftLayer: Layer,
  rightLayer: Layer,
  mappingFn: (a: SourceFile, b: SourceFile) => boolean,
): LayerPair[] {
  const pairs: LayerPair[] = []
  for (const left of leftLayer.files) {
    for (const right of rightLayer.files) {
      if (mappingFn(left, right)) {
        pairs.push({
          left,
          leftLayer: leftLayer.name,
          right,
          rightLayer: rightLayer.name,
        })
      }
    }
  }
  return pairs
}

/**
 * Builder for cross-layer consistency rules.
 *
 * Unlike RuleBuilder<T>, this operates on pairs of elements from different layers.
 * The chain is: `.layer()` -> `.mapping()` -> `.forEachPair()` -> `.should()` -> `.check()`
 *
 * @example
 * crossLayer(project)
 *   .layer('routes', 'src/routes/**')
 *   .layer('schemas', 'src/schemas/**')
 *   .mapping((a, b) => a.getBaseName().replace('Route', '') === b.getBaseName().replace('Schema', ''))
 *   .forEachPair()
 *   .should(haveMatchingCounterpart())
 *   .check()
 */
export class CrossLayerBuilder {
  private readonly _layerDefs: Array<{ name: string; pattern: string }> = []

  constructor(private readonly project: ArchProject) {}

  /**
   * Define a layer by name and glob pattern.
   * At least two layers must be defined before calling `.mapping()`.
   */
  layer(name: string, pattern: string): CrossLayerBuilder {
    this._layerDefs.push({ name, pattern })
    return this
  }

  /**
   * Provide a mapping function that determines which elements form pairs.
   * The function receives one element from each layer and returns `true` if they should be paired.
   *
   * Requires at least 2 layers to have been defined.
   */
  mapping(fn: (a: SourceFile, b: SourceFile) => boolean): MappedCrossLayerBuilder {
    if (this._layerDefs.length < 2) {
      throw new RangeError('CrossLayerBuilder requires at least 2 layers before calling .mapping()')
    }

    // Resolve all layers
    const layers = this._layerDefs.map((def) => resolveLayer(this.project, def.name, def.pattern))

    // Compute pairs between consecutive layers
    const allPairs: LayerPair[] = []
    for (let i = 0; i < layers.length - 1; i++) {
      allPairs.push(...computePairs(layers[i]!, layers[i + 1]!, fn))
    }

    return new MappedCrossLayerBuilder(layers, allPairs)
  }
}

/**
 * Intermediate builder after `.mapping()` has been called.
 * The layers are resolved and pairs computed.
 */
export class MappedCrossLayerBuilder {
  constructor(
    private readonly layers: Layer[],
    private readonly pairs: LayerPair[],
  ) {}

  /**
   * Iterate over each matched pair. Returns a builder for attaching conditions.
   */
  forEachPair(): PairConditionBuilder {
    return new PairConditionBuilder(this.layers, this.pairs)
  }
}

/**
 * Builder after `.forEachPair()` — attach a pair condition via `.should()`.
 */
export class PairConditionBuilder {
  constructor(
    private readonly layers: Layer[],
    private readonly pairs: LayerPair[],
  ) {}

  /**
   * Attach a pair condition to evaluate against matched pairs.
   */
  should(condition: PairCondition): PairFinalBuilder {
    return new PairFinalBuilder(this.layers, this.pairs, condition)
  }
}

/**
 * Terminal builder — call `.check()`, `.warn()`, or `.because()`.
 */
export class PairFinalBuilder {
  private _reason?: string
  private _metadata?: RuleMetadata

  constructor(
    private readonly layers: Layer[],
    private readonly pairs: LayerPair[],
    private readonly condition: PairCondition,
  ) {}

  /**
   * Attach a human-readable rationale to the rule.
   * Included in violation messages when `.check()` throws.
   */
  because(reason: string): PairFinalBuilder {
    this._reason = reason
    return this
  }

  /**
   * Attach rich metadata to the rule.
   */
  rule(metadata: RuleMetadata): PairFinalBuilder {
    this._metadata = metadata
    if (metadata.because) {
      this._reason = metadata.because
    }
    return this
  }

  /**
   * Execute the rule and throw `ArchRuleError` if any violations are found.
   */
  check(options?: CheckOptions): void {
    let violations = this.evaluate()

    if (options?.baseline) {
      violations = options.baseline.filterNew(violations)
    }

    if (options?.diff) {
      violations = options.diff.filterToChanged(violations)
    }

    if (violations.length > 0) {
      if (options?.format === 'github') {
        process.stdout.write(formatViolationsGitHub(violations, 'error') + '\n')
      }
      throw new ArchRuleError(violations, this._reason)
    }
  }

  /**
   * Execute the rule and log violations to stderr. Does not throw.
   */
  warn(options?: CheckOptions): void {
    let violations = this.evaluate()

    if (options?.baseline) {
      violations = options.baseline.filterNew(violations)
    }

    if (options?.diff) {
      violations = options.diff.filterToChanged(violations)
    }

    if (violations.length > 0) {
      if (options?.format === 'json') {
        console.warn(formatViolationsJson(violations, this._reason))
      } else if (options?.format === 'github') {
        process.stdout.write(formatViolationsGitHub(violations, 'warning') + '\n')
      } else {
        console.warn(formatViolations(violations, this._reason))
      }
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
    const layerNames = this.layers.map((l) => l.name)
    const context: ConditionContext = {
      rule: `cross-layer [${layerNames.join(', ')}] should ${this.condition.description}`,
      because: this._reason,
      ruleId: this._metadata?.id,
      suggestion: this._metadata?.suggestion,
      docs: this._metadata?.docs,
    }

    return this.condition.evaluate(this.pairs, context)
  }
}

/**
 * Entry point: create a cross-layer consistency rule builder.
 *
 * @param p - The loaded ArchProject
 * @returns A CrossLayerBuilder — call `.layer()` at least twice, then `.mapping()`
 *
 * @example
 * crossLayer(project)
 *   .layer('routes', 'src/routes/**')
 *   .layer('schemas', 'src/schemas/**')
 *   .mapping((a, b) => a.getBaseName().replace('-route', '') === b.getBaseName().replace('-schema', ''))
 *   .forEachPair()
 *   .should(haveMatchingCounterpart())
 *   .check()
 */
export function crossLayer(p: ArchProject): CrossLayerBuilder {
  return new CrossLayerBuilder(p)
}
