import type { SourceFile } from 'ts-morph'
import type { PairCondition } from '../core/pair-condition.js'
import type { PairConditionContext } from '../core/pair-condition.js'
// Every condition here now declares `PairConditionContext`, because all three
// read `context.layers` (plan 0080). The bivariance property that let the two
// siblings keep `ConditionContext` is still true and still matters for external
// implementers — it is asserted in `tests/presets`-adjacent type probes rather
// than relied on here.
import type { ArchViolation } from '../core/violation.js'
import type { LayerPair, Layer } from '../models/cross-layer.js'
import { setCorrespondence } from '../core/correspondence-core.js'
import { UNSUPPRESSABLE } from '../core/unsuppressable.js'
import { marksOwnEmptyDiscovery } from '../core/owns-empty-discovery.js'

/**
 * Every element in the left layer must have at least one match in the right layer.
 *
 * Produces a violation for each left-layer file that has no matching pair.
 * "Match" is determined by the mapping function provided via `.mapping()`.
 *
 * This is an existence/coverage check, so it shares the set-difference +
 * non-vacuity core (`setCorrespondence`, F2) with `correspondence()` — the two
 * "every X has a matching Y" engines cannot drift, and neither can silently
 * green on an empty side: a left layer that matched **zero** files is a
 * mis-globbed layer that enforces nothing, so it now fails (ADR-008) rather
 * than passing vacuously.
 *
 * @param explicitLayers - Optional, and kept only so existing callers compile.
 *   The builder supplies its own resolved layers through the context, and those
 *   win — see `PairConditionContext`.
 */
/**
 * The finding for a layer that resolved no files, shared by all three conditions.
 *
 * A layer with no files makes every pair through it unchecked, so the condition
 * enforces nothing — [bug 0040](../../bugs/fixed/0040-a-crosslayer-rule-reports-nothing-when-its-layer-resolves-nothing.md).
 * `haveMatchingCounterpart` guarded this from the start; `haveConsistentExports`
 * and `satisfyPairCondition` did not, and measured **4 violations → 0** on a dead
 * layer. Now one helper, so a fourth condition cannot arrive without it and the
 * three cannot drift.
 *
 * ## Why here and not in the dead-glob gate
 *
 * The gate can see that a `.layer()` glob is dead, and plan 0080 admits discovery
 * globs to it for exactly that reason. But the gate short-circuits before the
 * condition runs, so it would **replace** this finding — and this one is better:
 * it names the layer, and its remedy has been corrected three times to point at
 * the `.layer()` call the reader must edit (bug 0042). `PairFinalBuilder`
 * therefore declares `ownsDiscoveryDiagnosis()`, and the knowledge stays with the
 * code that has it.
 */
function emptyLayerFinding(
  layer: Layer,
  layerCount: number,
  context: PairConditionContext,
): ArchViolation {
  return {
    rule: context.rule,
    element: layer.name,
    file: '',
    line: 1,
    message: `Layer "${layer.name}" matched 0 files — a correspondence over an empty layer enforces nothing. Fix the layer glob.`,
    because: context.because,
    ruleId: context.ruleId,
    // Its own remedy, never the author's (bug 0042, a live recurrence of
    // bug 0021). This used to be `suggestion: context.suggestion` /
    // `docs: context.docs`, which failed two ways at once. With author
    // metadata it printed the author's fix for a real violation as this
    // finding's `Fix:` — measured, an empty-layer finding advising "Split
    // the cycle by extracting a shared module." With none, `suggestion` is
    // optional on `ConditionContext`, so the finding shipped with no remedy
    // at all — the only producer in the census that could. (It said "of the
    // thirteen" until the census grew to fifteen. The count is derived in
    // `tests/core/every-config-finding-is-classified.test.ts`; repeating it
    // here only created something to go stale.)
    //
    // `execute-rule.ts`'s bug-0021 guard cannot help here. It withholds the
    // author's text from producers that leave the field unset; this one
    // assigned it, so there was nothing to withhold. Same escape
    // `correspondence-builder.ts` closed with a producer-side remedy.
    //
    // `ruleId` and `because` are **redundant with enrichment**, which
    // backfills both — removing either leaves the suite green, measured.
    // Kept for locality: a reader of this producer should see the whole
    // finding, and `terminal-builder.ts` documents the same discovery.
    // Neither claims a cause, which is why they are safe to carry where
    // `suggestion` and `docs` are not.
    //
    // The removal clause is COMPUTED, because no fixed text is true for
    // both chain lengths — and the first version of this remedy shipped
    // the false one. "Or remove the layer from the chain" is impossible
    // on a two-layer chain: `.mapping()` throws `RangeError` below two
    // layers (`cross-layer-builder.ts:111`) and this finding cannot fire
    // below two either (`:27`), so the advice was unreachable on exactly
    // the shape that produces it. Measured. That is bug 0017's shape, in
    // the change whose subject was bug 0017's shape — which is the best
    // argument in this file for rule 2's behavioural corollary: a remedy
    // is a claim, and reading well is not evidence.
    //
    // **Third** version of this sentence. Each earlier one was wrong, and
    // each was wrong in a way worth keeping written down:
    //
    //  1. "or remove the layer from the chain" — impossible on a
    //     two-layer chain, which is the only shape that produces this
    //     finding. Replaced by the computed clause below.
    //  2. "in the `Layer[]` passed to this condition" — true only while
    //     the condition judged a caller-supplied copy. Bug 0040 removed
    //     that array, so the remedy came to point at something that no
    //     longer exists.
    //
    // Both were bug 0017's shape, and neither was catchable by asserting
    // the message's content: the guard checked that it named the layer,
    // which all three versions do. Only applying the fix found them.
    //
    // The glob named here IS now the `.layer()` glob, so the remedy names
    // the call the reader has to edit.
    suggestion:
      `Fix the .layer("${layer.name}", "${layer.pattern}") glob so it matches at ` +
      `least one file.` +
      (layerCount >= 3
        ? ` Or drop the layer: ${String(layerCount - 1)} would remain, still a valid chain.`
        : ` Dropping the layer is not available here — a chain needs two, and this one has` +
          ` ${String(layerCount)}. Delete the rule instead if the layer should not exist.`) +
      ` Until then every pair through this layer is unchecked, so the rule reports` +
      ` nothing whether the code complies or not. ${UNSUPPRESSABLE}`,
    // Config-level meta-finding: no source file, so it must survive
    // diff-aware/baseline or the guard re-greens under standard CI.
    bypassFilters: true,
  }
}

/**
 * The finding for a layer set too small to judge, shared by all three conditions.
 *
 * A pair condition needs two layers. Below that all three used to `return []` —
 * **silently**, which is the exact false green this library exists to remove,
 * inside the library. Review measured the divergence that exposed it: with an
 * empty `context.layers` and a two-layer argument, `haveMatchingCounterpart`
 * reported 2 findings and its two siblings reported 0.
 *
 * Unreachable through the DSL — `.mapping()` throws below two layers
 * (`cross-layer-builder.ts:111`) — so this is the direct-`evaluate()` path, which
 * is public: `PairCondition` is an interface external code can call and the
 * conditions are exported. Same reachability as the defect fixed in v0.43.1.
 *
 * A finding rather than a `throw`, because a condition that throws takes down the
 * whole run and this is recoverable information about one rule.
 */
function unusableLayersFinding(count: number, context: PairConditionContext): ArchViolation {
  return {
    rule: context.rule,
    element: '(layer set)',
    file: '',
    line: 1,
    message:
      `A pair condition was evaluated against ${String(count)} layer(s) — it needs two, ` +
      `so it judged nothing.`,
    because: context.because,
    ruleId: context.ruleId,
    // Its own remedy, never the author's (bug 0021/0042).
    suggestion:
      `Build the rule through crossLayer(project).layer(...).layer(...).mapping(...), which ` +
      `guarantees at least two layers. If you are calling evaluate() directly, pass a ` +
      `PairConditionContext whose \`layers\` holds every layer the pairs were drawn from — ` +
      `with fewer than two there are no pairs to judge, so the condition reports nothing ` +
      `whether the code complies or not. ${UNSUPPRESSABLE}`,
    bypassFilters: true,
  }
}

export function haveMatchingCounterpart(explicitLayers?: Layer[]): PairCondition {
  // Registers itself as owning the empty-layer diagnosis (plan 0081).
  return marksOwnEmptyDiscovery({
    description: 'have a matching counterpart in the paired layer',
    evaluate(pairs: LayerPair[], context: PairConditionContext): ArchViolation[] {
      // The BUILDER's layers by default (bug 0040). The argument is kept, and
      // optional, so every existing caller still compiles — but the context
      // wins, because a hand-built array is a second copy of the builder's
      // resolution and judging the copy is the defect.
      //
      // Note the silent semantic change this implies, and it is the fix rather
      // than a side effect: a caller who deliberately passed a NARROWER array
      // now gets the builder's. Pinned by a precedence test.
      // `>= 2`, not `> 0`. A pair condition needs two layers to mean anything, so
      // a context carrying ONE must not win over a usable argument: with
      // `> 0` it did, and the condition then returned `[]` at the guard below —
      // a silent vacuous pass, which is the class ADR-008 exists for. Measured:
      // context 1 layer + argument 2 layers → 0 findings.
      //
      // Safe for every builder path, and that is why the threshold can move: the
      // builder cannot produce fewer than two, because `.mapping()` throws below
      // two (`cross-layer-builder.ts:111`). So this cannot let the argument win
      // over a real builder resolution — the defect bug 0040 fixed — it only
      // removes the unusable-context case.
      const fromContext = context.layers.length >= 2 ? context.layers : undefined
      const layers = fromContext ?? explicitLayers ?? []
      if (layers.length < 2) return [unusableLayersFinding(layers.length, context)]

      // EVERY layer, before the pair loop — including the last one.
      //
      // This check used to live inside the loop below, which walks `layers[i]` for
      // `i < length - 1`, so the **final** layer was never examined. Bug 0040
      // named that its "missing case" and rated it worse than the silence, and it
      // is: measured on a dead final layer, this condition produced **0**
      // configuration findings and **2** ordinary ones reading *"has no matching
      // counterpart in layer ghost"*. An agent obeying that writes files into a
      // layer whose glob is wrong, they still do not match, and it improvises —
      // bug 0017's shape.
      //
      // Its two siblings already checked all layers, so the three disagreed about
      // the same input. Hoisting it here makes them consistent and closes the
      // missing case with one code path rather than three.
      const empty = layers.filter((layer) => layer.files.length === 0)
      if (empty.length > 0) {
        return empty.map((layer) => emptyLayerFinding(layer, layers.length, context))
      }

      const violations: ArchViolation[] = []

      // Check consecutive layer pairs
      for (let i = 0; i < layers.length - 1; i++) {
        const leftLayer = layers[i]
        const rightLayer = layers[i + 1]
        if (!leftLayer || !rightLayer) continue

        // Collect all left files that appear in at least one pair
        const matchedLeftFiles = new Set<string>()
        for (const pair of pairs) {
          if (pair.leftLayer === leftLayer.name && pair.rightLayer === rightLayer.name) {
            matchedLeftFiles.add(pair.left.getFilePath())
          }
        }

        // Find unmatched left files via the shared set-difference core (F2).
        const { missing } = setCorrespondence(
          leftLayer.files.map((file) => file.getFilePath()),
          matchedLeftFiles,
        )
        const missingPaths = new Set(missing)
        for (const file of leftLayer.files) {
          if (!missingPaths.has(file.getFilePath())) continue
          violations.push({
            rule: context.rule,
            element: file.getBaseName(),
            file: file.getFilePath(),
            line: 1,
            message: `File "${file.getBaseName()}" in layer "${leftLayer.name}" has no matching counterpart in layer "${rightLayer.name}"`,
            because: context.because,
            ruleId: context.ruleId,
            suggestion: context.suggestion,
            docs: context.docs,
          })
        }
      }

      return violations
    },
  })
}

/**
 * The matched pair must have consistent exported symbol names.
 *
 * Takes two extractor functions that pull symbol names from each side.
 * Every symbol extracted from the left file must appear in the right file.
 */
export function haveConsistentExports(
  extractLeft: (file: SourceFile) => string[],
  extractRight: (file: SourceFile) => string[],
): PairCondition {
  // Registers itself as owning the empty-layer diagnosis (plan 0081).
  return marksOwnEmptyDiscovery({
    description: 'have consistent exports between paired layers',
    evaluate(pairs: LayerPair[], context: PairConditionContext): ArchViolation[] {
      const violations: ArchViolation[] = []

      // The guard `haveMatchingCounterpart` had and this did not. Measured on a
      // dead left layer: **4 violations → 0**, a false green (bug 0040).
      if (context.layers.length < 2) {
        return [unusableLayersFinding(context.layers.length, context)]
      }

      const empty = context.layers.filter((layer) => layer.files.length === 0)
      if (empty.length > 0) {
        return empty.map((layer) => emptyLayerFinding(layer, context.layers.length, context))
      }

      for (const pair of pairs) {
        const leftSymbols = extractLeft(pair.left)
        const rightSymbols = new Set(extractRight(pair.right))

        for (const symbol of leftSymbols) {
          if (!rightSymbols.has(symbol)) {
            violations.push({
              rule: context.rule,
              element: pair.left.getBaseName(),
              file: pair.left.getFilePath(),
              line: 1,
              message: `Symbol "${symbol}" in "${pair.left.getBaseName()}" (${pair.leftLayer}) has no counterpart in "${pair.right.getBaseName()}" (${pair.rightLayer})`,
              because: context.because,
              ruleId: context.ruleId,
              suggestion: context.suggestion,
              docs: context.docs,
            })
          }
        }
      }

      return violations
    },
  })
}

/**
 * Custom pair assertion — shorthand for inline PairCondition.
 *
 * The provided function is called for each pair. Return an `ArchViolation`
 * to signal failure, or `null` if the pair is consistent.
 */
export function satisfyPairCondition(
  description: string,
  fn: (pair: LayerPair) => ArchViolation | null,
): PairCondition {
  // Registers itself as owning the empty-layer diagnosis (plan 0081).
  return marksOwnEmptyDiscovery({
    description,
    evaluate(pairs: LayerPair[], context: PairConditionContext): ArchViolation[] {
      // Same guard, same reason (bug 0040). A custom pair assertion over an empty
      // layer is asserted about nothing, whatever the callback does.
      if (context.layers.length < 2) {
        return [unusableLayersFinding(context.layers.length, context)]
      }

      const empty = context.layers.filter((layer) => layer.files.length === 0)
      if (empty.length > 0) {
        return empty.map((layer) => emptyLayerFinding(layer, context.layers.length, context))
      }

      const violations: ArchViolation[] = []
      for (const pair of pairs) {
        const result = fn(pair)
        if (result !== null) {
          violations.push(result)
        }
      }
      return violations
    },
  })
}
