import picomatch from 'picomatch'
import type { CollectResult } from '../core/terminal-builder.js'
import type { SourceFile } from 'ts-morph'
import type { ArchProject } from '../core/project.js'
import { ownsEmptyDiscovery } from '../core/owns-empty-discovery.js'
import type { PairCondition, PairConditionContext } from '../core/pair-condition.js'
import type { Layer, LayerPair } from '../models/cross-layer.js'
import type { GlobNode } from '../core/glob-site.js'
import { globAnyOf, stampGlobs } from '../core/glob-site.js'
import { TerminalBuilder } from '../core/terminal-builder.js'
import { shallowClone } from '../core/shallow-clone.js'
import { isProjectRelative, relativeToRoot } from '../core/project-relative.js'

/**
 * Resolve a layer by matching its glob against the project's source files.
 */
function resolveLayer(project: ArchProject, name: string, pattern: string): Layer {
  const isMatch = picomatch(pattern)
  const relative = isProjectRelative(pattern)
  const files: SourceFile[] = []
  for (const sf of project.getSourceFiles()) {
    const filePath = sf.getFilePath()
    // Bug 0036: the glob is matched against an ABSOLUTE path, so a
    // project-relative one could never resolve a layer. Same rule as every
    // other path glob — relative means from the project root.
    const fromRoot = relative ? relativeToRoot(sf, filePath, project.tsConfigPath) : undefined
    if (isMatch(filePath) || (fromRoot !== undefined && isMatch(fromRoot))) {
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
 *   .layer('routes', '**\/src/routes/**')
 *   .layer('schemas', '**\/src/schemas/**')
 *   .mapping((a, b) => a.getBaseName().replace('Route', '') === b.getBaseName().replace('Schema', ''))
 *   .forEachPair()
 *   .should(haveMatchingCounterpart())
 *   .check()
 */
export class CrossLayerBuilder {
  private _layerDefs: Array<{ name: string; pattern: string }> = []

  constructor(private readonly project: ArchProject) {}

  /**
   * Define a layer by name and glob pattern.
   * At least two layers must be defined before calling `.mapping()`.
   */
  layer(name: string, pattern: string): this {
    const next = this.copy()
    next._layerDefs.push({ name, pattern })
    return next
  }

  /**
   * An independent copy, carrying the layer definitions (bug 0016).
   *
   * This class does not extend {@link TerminalBuilder} — it produces a rule
   * rather than being one — so it does not inherit that class's `copy()`. It
   * still needs copy-on-write for the same reason: a held `crossLayer(p)`
   * accumulated a layer per `.layer()` call across every rule derived from it,
   * and `mapping()` pairs *consecutive* layers, so an extra layer silently
   * changes which pairs a later rule compares.
   */
  private copy(): this {
    const clone = shallowClone(this)
    clone._layerDefs = [...this._layerDefs]
    return clone
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
      const left = layers[i]
      const right = layers[i + 1]
      if (left && right) allPairs.push(...computePairs(left, right, fn))
    }

    return new MappedCrossLayerBuilder(layers, allPairs, this.project)
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
    private readonly project?: ArchProject,
  ) {}

  /**
   * Iterate over each matched pair. Returns a builder for attaching conditions.
   */
  forEachPair(): PairConditionBuilder {
    return new PairConditionBuilder(this.layers, this.pairs, this.project)
  }
}

/**
 * Builder after `.forEachPair()` — attach a pair condition via `.should()`.
 */
export class PairConditionBuilder {
  constructor(
    private readonly layers: Layer[],
    private readonly pairs: LayerPair[],
    private readonly project?: ArchProject,
  ) {}

  /**
   * Attach a pair condition to evaluate against matched pairs.
   */
  should(condition: PairCondition): PairFinalBuilder {
    return new PairFinalBuilder(this.layers, this.pairs, condition, this.project)
  }
}

/**
 * Terminal builder — call `.check()`, `.warn()`, or `.because()`.
 */
export class PairFinalBuilder extends TerminalBuilder {
  /**
   * @param project - Optional so the constructor stays source-compatible; the
   *   chain always supplies it. Without it `doctor` cannot check this rule's
   *   layer globs and has to report that it could not, which is honest but
   *   useless — and used to be silent.
   */
  constructor(
    private readonly layers: Layer[],
    private readonly pairs: LayerPair[],
    private readonly condition: PairCondition,
    private readonly project?: ArchProject,
  ) {
    super()
  }

  /** The project this rule was built against. See `RuleBuilder.getProject`. */
  getProject(): ArchProject | undefined {
    return this.project
  }

  /**
   * The layer globs, one tree each.
   *
   * Per layer rather than one `any` node, for the same reason as
   * `assignedFrom`: a dead glob means that layer is empty, and every pair
   * involving it is silently unchecked. Folding them together would report a
   * fault only when EVERY layer was empty.
   */
  override globs(): readonly GlobNode[] {
    return this.layers.map((layer) =>
      stampGlobs(
        globAnyOf(
          [layer.pattern],
          'file-path',
          isProjectRelative(layer.pattern) ? 'normalized' : 'absolute',
        ),
        'discovery',
        (g) => `layer("${layer.name}", "${g.glob}")`,
      ),
    )
  }

  /**
   * Does the condition this rule was built with diagnose its own empty layers?
   *
   * **Asked of the condition, not asserted about all of them** (plan 0081). This
   * returned a bare `true` while the docstring here claimed "all three produce a
   * finding naming the layer" — and at v0.45.0 that was false, because
   * `haveMatchingCounterpart` missed a dead FINAL layer. The blanket declaration
   * suppressed the gate for precisely the case its declared owner did not handle,
   * so the reader got silence instead of a generic message
   * ([bug 0040](../../bugs/fixed/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md)).
   *
   * A prose claim about three implementations goes stale when a fourth arrives.
   * A tag read off the condition cannot: an untagged condition is covered by the
   * gate, which is the recoverable direction.
   *
   * The gate is worth standing down for when the tag IS present: it short-circuits
   * before the condition runs, and the condition's finding names the dead layer
   * and points at the `.layer()` call to edit — a remedy corrected three times
   * before it was right (bug 0042).
   */
  protected override ownsDiscoveryDiagnosis(): boolean {
    // A registry lookup, not a property read. The property form — symbol-keyed on
    // the condition — was readable off any shipped condition via
    // `Object.getOwnPropertySymbols` and could be copied onto a user condition that
    // reports nothing, which measured 0 findings on a dead layer. `WeakSet`
    // membership cannot be read off the object, so there is nothing to copy.
    return ownsEmptyDiscovery(this.condition)
  }

  /**
   * Pairs this rule examined — plan 0098. `condition.evaluate` receives exactly
   * this array, so the count cannot drift from what was checked.
   */

  /**
   * This family counts layer pairs — the pairs of layers it compares.
   *
   * Plan 0099: `CollectResult.examined` is unit-typed per family (ADR-009 part
   * 1), and the zero-examined message prints the noun. Inheriting the base
   * `'subjects'` is a category error in a sentence whose whole job is naming what
   * was and was not looked at.
   */
  protected override examinedUnitNoun(): string {
    return 'layer pairs'
  }

  examinedUnits(): number {
    return this.pairs.length
  }

  protected collectViolations(): CollectResult {
    const layerNames = this.layers.map((l) => l.name)
    const context: PairConditionContext = {
      rule: `cross-layer [${layerNames.join(', ')}] should ${this.condition.description}`,
      because: this._reason,
      ruleId: this._metadata?.id,
      suggestion: this._metadata?.suggestion,
      docs: this._metadata?.docs,
      // The builder's OWN resolved layers (bug 0040). A condition that needs
      // them no longer has to be handed a copy the caller assembled — which was
      // impossible to assemble correctly, since `layers` is private here and
      // `resolveLayer` is not exported.
      layers: this.layers,
    }

    // Plan 0098: the pairs ARE the examined set — `evaluate` receives exactly
    // this array, so the count cannot drift from what was checked.
    return {
      violations: this.condition.evaluate(this.pairs, context),
      examined: this.examinedUnits(),
    }
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
 *   .layer('routes', '**\/src/routes/**')
 *   .layer('schemas', '**\/src/schemas/**')
 *   .mapping((a, b) => a.getBaseName().replace('-route', '') === b.getBaseName().replace('-schema', ''))
 *   .forEachPair()
 *   .should(haveMatchingCounterpart())
 *   .check()
 */
export function crossLayer(p: ArchProject): CrossLayerBuilder {
  return new CrossLayerBuilder(p)
}
