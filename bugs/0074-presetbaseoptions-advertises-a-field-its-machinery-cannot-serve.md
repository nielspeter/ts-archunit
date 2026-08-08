# Bug 0074: `PresetBaseOptions` advertises `expectEmpty` to third-party presets, and the machinery that implements it is not exported

**Reported:** 2026-08-08 · **Fixed:** not yet
**Found in:** the five-persona review of [plan 0089](../plans/completed/0089-presets-forward-their-options.md)
(product persona, round 1).
**Severity:** **Low frequency, published-API blast radius** — [ADR-008](../adr/008-agent-first-failure-surfaces.md)
rule 6's top row. It costs nothing until someone writes a preset outside this package, and then it fails
in the one place the in-repo guardrail cannot fire.

## What happens

`src/presets/index.ts` exports `PresetBaseOptions`, which since 0089 declares:

```ts
expectEmpty?: readonly TRuleId[]
```

It does **not** export `declareEmptyIfListed`, `declaredEmptyFindings` or `collectRule` — verified
against the file: the entry point ships the five preset functions, their option types,
`PresetBaseOptions`, `RuleSeverity` and `validateOverrides`, and nothing else.

Under [ADR-006](../adr/006-framework-rules-architecture.md), framework rules ship as separate packages
and presets are functions. So a third-party preset does the natural thing —

```ts
export interface MyPresetOptions extends PresetBaseOptions<MyRuleId> {}
```

— and thereby **advertises a field it silently ignores**. Its users write `expectEmpty: ['my/rule']`,
get no error, and get no declaration either. There is no unbound-id finding, because the mechanism that
produces one is not reachable.

That is the identical failure the in-repo guardrail exists to prevent — _"a declaration that binds to no
rule is not a weaker assertion, it is no assertion"_ — occurring in the one place the guardrail cannot
fire. It is silent by construction, and a compile error is impossible because the field is inherited
rather than implemented.

## Why the type is the trap

`overrides` has the same shape and does not have this problem, because `validateOverrides` **is**
exported. A third-party preset that inherits `overrides` can reach the validator. 0089 added a second
field to the same base type without adding its second validator to the same entry point, so the two
halves of the base type now have different reachability.

## Two candidate fixes

1. **Export the carrier and the finder** — `declareEmptyIfListed` and `declaredEmptyFindings`, with the
   three-line contract documented: apply the carrier at every construction site, record what you
   actually built, and pass the constructed set to the finder. This makes the ADR-006 story complete
   and matches the `validateOverrides` precedent already in that file.
2. **Move `expectEmpty` out of `PresetBaseOptions`** into a separate type the in-repo presets compose,
   so an implementer opts in deliberately rather than inheriting a promise.

(1) is preferable: the field is genuinely generic and the mechanism is small. But it makes three more
functions published surface, which is a real cost and interacts with
[bug 0071](./0071-nothing-guards-the-published-method-surface.md) — nothing currently guards the
published method surface, so newly-exported helpers would be unguarded the day they ship. Worth
deciding alongside 0071 rather than before it.

Note also that `collectRule`'s fourth parameter changed in 0089 from an overrides map to the whole
config. That is a **fail-open** break if it is ever published — an old caller's map would read as
`config.overrides === undefined` and silently return every rule to its default. It is safe today
precisely because it is not exported; if (1) is taken, `collectRule` should stay internal or take the
change into account.
