# Plan 0089 — presets forward their options, and upgrade notes name the presets

**Status:** Open, not started. Filed 2026-08-04 from the v0.47.0–v0.49.0 review.
**Priority:** Medium. The population most exposed to the three behaviour changes has the least control
over them.
**Effort:** Small-medium. Threading one options bag; the care is in not multiplying the surface.
**Blast radius:** **Published API on two presets, additive.** New optional fields only; nothing existing
changes behaviour. Middle row of [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6 — prove each
option arrives and stop.

## Problem

`layeredArchitecture` and `strictBoundaries` hardcode their conditions:

```ts
slices(p).assignedFrom(sliceDef).should().beFreeOfCycles(),
```

No `ImportOptions` reaches them. So a preset user affected by v0.47.0's default flip, v0.48.0's re-export
edges or v0.49.0's `verbatimModuleSyntax` reading has exactly one lever: `overrides` to change the
_severity_. They cannot say "count type edges" or "do not".

Two compounding facts make this worse than a missing convenience:

1. **`layeredArchitecture` runs `respectLayerOrder` and `beFreeOfCycles` over one slice set**, and since
   v0.47.0 those two **disagree by design** about whether a type-only edge is a dependency. The reasoning
   is sound (a cycle asks whether the module is evaluated; layering asks whether the code is coupled) and
   the preset user cannot align them even if their project wants them aligned.
2. **The upgrade notes scope themselves by API names a preset user never types.** `docs/upgrading.md` says
   _"Only if you use `slices()` rules"_ and _"Only if you baseline `beFreeOfCycles()` findings"_. Someone
   who calls `layeredArchitecture(p, …)` reads both as "not me" — and is wrong, because the preset contains
   both conditions.

## Phase 1 — forward the options

Add an optional `importOptions?: ImportOptions` to `LayeredArchitectureOptions` and
`StrictBoundariesOptions`, forwarded to every condition in the preset that takes one.

**Resist the obvious generalisation.** A per-rule options map (`{ 'preset/layered/no-cycles': {…} }`)
covers more cases and is a second override mechanism beside the one that already exists. Ship the single
bag; if a real need for per-rule options appears, it belongs beside `overrides` and shaped like it, not as
a parallel scheme. ADR-006: presets are functions, and a function's options should read like options.

**Then decide the harder question:** does forwarding one bag re-break the deliberate default split? If a
user passes `{ ignoreTypeImports: true }`, the cycle rule already does that and the layer rules newly stop
counting type coupling — which may be exactly what they meant, or may silently weaken a rule they were
relying on. Two defensible answers: forward it to both and document it, or split the field. Decide it in
the plan, not in the code.

## Phase 2 — the upgrade notes name the presets

Every enforcement-changing row in `docs/upgrading.md` should name the **presets** containing the affected
condition, not only the condition. Mechanically checkable: for each condition named in a row, the presets
that construct it are derivable from `src/presets/`, so a guard can assert the row mentions them.

That guard is the durable half. A row scoped by a name the reader does not use is the same class of defect
as the stale prose in v0.49.1 — text that is true and unreachable.

## Test inventory

1. **The option reaches `beFreeOfCycles` in both presets**, proven where it changes the answer: a type-only
   cycle reported or not depending on the field. A row asserting the same result either way proves nothing —
   that mistake was made and caught in plan 0085.
2. **The option reaches the layer/boundary conditions**, same standard.
3. **Omitting the option preserves today's behaviour exactly**, per condition — the additive claim.
4. **Every `docs/upgrading.md` row naming a condition also names its presets**, derived from `src/presets/`
   rather than a hand-written list.
5. **VACUITY: the preset really constructed the rule** in each row — these presets skip rules when discovery
   finds nothing, so a fixture that discovers no boundaries makes every row vacuously true.

## Out of scope

- **Per-rule options maps.** See Phase 1.
- **Changing any preset default.** Forwarding only.

## Related

- [Plan 0084](./completed/0084-cycle-detection-that-ignores-type-only-imports.md),
  [0085](./completed/0085-the-slice-graph-cannot-see-a-re-export.md),
  [0087](./completed/0087-an-inline-type-import-still-requests-the-module.md) — the three changes preset
  users cannot respond to.
- `src/presets/layered.ts`, `src/presets/boundaries.ts`, `docs/upgrading.md`.
