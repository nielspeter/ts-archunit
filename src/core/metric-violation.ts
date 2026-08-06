import type { Node } from 'ts-morph'
import type { ArchViolation } from './violation.js'
import { createViolation, getElementName } from './violation.js'

/**
 * A finding whose message states a **measurement** — bug 0012.
 *
 * Metric conditions write the measured value into the message:
 *
 *     Big has 10 methods (max: 5) — consider splitting into focused classes
 *
 * `hashViolation` identifies a violation by its message, so the identity moved
 * whenever the measurement moved — **in either direction**. Baseline a class at
 * 10 methods, delete two, and the finding was reported as new:
 *
 *     10 → 10   green ✓
 *     10 → 12   red   ✓  (worse)
 *     10 → 8    RED   ✗  (better — the defect)
 *     10 → 5    green ✓  (under the threshold)
 *
 * Paying down the debt failed CI, and kept failing on every incremental step
 * until the class dropped under the threshold entirely. A team that split four
 * methods out of an 87-method service got a red build for its trouble. The
 * external audit that motivated this recommends adopting these rules "behind a
 * ratchet (accept today's god objects, block new regressions)" and records them
 * at **zero uses** — the ratchet they were told to use did not work.
 *
 * ## Why identity alone cannot fix it
 *
 * Bug 0010 added `identity` for messages that state a derived population, and
 * applying it naively here trades one failure for a worse one:
 *
 * | identity contains | improving to 8 | regressing to 12 |
 * | ----------------- | -------------- | ---------------- |
 * | the count         | **red** ✗      | red ✓            |
 * | no count          | green ✓        | **green** ✗      |
 *
 * Dropping the count turns the baseline into a mute button. Identity answers
 * "is this the same finding?", and a metric needs "is it **worse** than what we
 * accepted?" — a comparison, not an equality. So this carries both: a stable
 * identity that finds the entry, and `measured`, which the baseline stores and
 * compares. See `Baseline.isKnown`.
 *
 * **Ten sites produce these, not the eight the bug enumerated.** That table was
 * built by grepping the `has N <noun>` message shape, which misses the two
 * complexity conditions — `has cyclomatic complexity N` puts the number last.
 * Both were left on `createViolation` in the first cut of this fix while the
 * docs already claimed complexity was ratcheted, so a reader would have removed
 * their CI escape hatch for a gate that still fired on every improvement. Found
 * by review; a mechanical enumeration by *shape* is not one by *behaviour*.
 */
export function metricViolation(
  node: Node,
  options: {
    /**
     * What is being measured — `methods`, `lines`, `parameters`, `properties`,
     * `named-exports`. Part of the identity, so one element can carry several
     * metric findings without them colliding.
     */
    metric: string
    /** The measurement now. Compared against the baselined value, not equated. */
    measured: number
    message: string
    /**
     * The element's qualified name, when `getElementName` would under-qualify it.
     *
     * Members need this: `getElementName(member)` returns the bare `save`, while
     * the message already says `UserRepo.save`. Two classes with a `save` method
     * would otherwise be one entry.
     */
    qualifiedName?: string
  },
  context: {
    rule: string
    because?: string
    suggestion?: string
    ruleId?: string
    docs?: string
  },
): ArchViolation {
  const base = createViolation(node, options.message, context)
  return {
    ...base,
    // The qualified name reaches `element` too, not only `identity` — bug 0068's
    // first consequence. `createViolation` derives it with `getElementName`,
    // which resolves an unnamed node up to its nearest named ancestor, so a
    // finding ABOUT an object-literal function was labelled with the ENCLOSING
    // function's name while its own message named it correctly. `element` is
    // what the terminal prints, what the JSON reports, and one of the three
    // fields string-form `.excluding()` matches by exact membership
    // (`execute-rule.ts`), so the disagreement also made an exclusion written
    // against the printed name silently miss.
    element: options.qualifiedName ?? base.element,
    // File, element and metric — never the value. The value is the thing being
    // ratcheted, so putting it here makes every change a new finding, which is
    // the bug. Leaving the FILE out is the other half, and it was shipped once:
    // two classes named `Big` in different files produced one identity, one
    // hash, and `withBaseline`'s last-write-wins picked whichever ceiling came
    // last — measured, a real 10 → 15 regression was silently accepted while
    // the sibling sat at 20. That is bug 0028's shape recreated inside bug
    // 0012's fix, and `ArchViolation.identity`'s own contract forbids it: "two
    // distinct violations sharing one identity are one violation to the
    // baseline, and accepting either accepts both."
    //
    // A path here is portable: `hashViolation` scrubs identity through
    // `normalizeIdentityText(text, root)`, which is what that scrub is for.
    identity: `${node.getSourceFile().getFilePath()}::${identityName(node, options.qualifiedName)}::${options.metric}`,
    measured: options.measured,
  }
}

/**
 * The name segment of a metric identity: the subject's own name, **scope-qualified
 * when its own name is not unique within the file**.
 *
 * Two names are available and neither is sufficient alone — measured across every
 * function shape:
 *
 * | shape                          | own name (`qualifiedName`) | scope (`getElementName`) |
 * | ------------------------------ | -------------------------- | ------------------------ |
 * | two factories returning `{build}` | `build`, `build` — COLLIDE | `makeAlpha`, `makeBeta` |
 * | an arrow inside a named function  | `errorResponseBuilder`     | `makeAlpha` — COLLIDES with the enclosing function's own finding |
 * | a bound literal `resolvers.top`   | `resolvers.top`            | `ArrowFunction` — no real scope |
 *
 * The own name alone was bug 0068's first fix and it moved the collision rather
 * than closing it: `owningBindingName` deliberately refuses to prefix a literal
 * that is returned from a factory or passed as an argument ("inventing one from a
 * distant ancestor would be a guess"), so both `build`s are just `build`. That
 * refusal is right for a **display name**, which is what it governs. An identity
 * is an opaque key, not a claim about what the thing is called, so qualifying it
 * by scope is not a guess — and the display name, the message and
 * `haveNameMatching` are all left exactly as they were.
 *
 * The scope is only used when it is a real name: `getElementName` falls back to
 * the node's kind (`ArrowFunction`) when no named ancestor exists, and a kind is
 * not a scope.
 */
function identityName(node: Node, qualifiedName: string | undefined): string {
  const scope = getElementName(node)
  const own = qualifiedName ?? scope
  const scopeIsRealName = scope !== node.getKindName()
  const alreadyCarriesScope = own.startsWith(`${scope}.`) || own.endsWith(`.${scope}`)
  if (!scopeIsRealName || own === scope || alreadyCarriesScope) return own
  return `${scope}.${own}`
}
