# Plan 0089 — presets forward their options, and upgrade notes name the presets

**Status:** Open, not started. Filed 2026-08-04 from the v0.47.0–v0.49.0 review.
**Priority:** Medium. The population most exposed to the three behaviour changes has the least control
over them.
**Effort:** Small-medium. Threading one options bag; the care is in not multiplying the surface.
**Blast radius:** **Published API on two presets, additive.** New optional fields only; nothing existing
changes behaviour. Middle row of [ADR-008](../../adr/008-agent-first-failure-surfaces.md) rule 6 — prove each
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

**The harder question, decided 2026-08-08: forward one bag to both, and name it alignment.**

Measured first, because the asymmetry is the whole argument. `beFreeOfCycles` defaults
`ignoreTypeImports: true` — it asks whether the module is _evaluated_, and an erased import cannot
contribute to an initialization cycle. `respectLayerOrder` and `notDependOn` default `false` — they ask
whether the code is _coupled_, and type coupling is coupling. So a single bag never changes both:

| user passes                    | cycle rule          | layer / boundary rules                   |
| ------------------------------ | ------------------- | ---------------------------------------- |
| `{ ignoreTypeImports: true }`  | unchanged (already) | **weakened** — stops counting type edges |
| `{ ignoreTypeImports: false }` | **strengthened**    | unchanged (already)                      |

Whichever value is passed, exactly one side moves — which is what made this look dangerous. It is not,
and the reason is in this plan's own Problem section: the stated need is that the two rules _"disagree by
design … and the preset user cannot align them even if their project wants them aligned."_ **Alignment is
the feature.** Splitting the field into two options would preserve the disagreement and leave the
problem this plan was filed for unsolved.

So the bag means one thing, stated in the option's own docstring: _this project's answer to "is a
type-only edge a dependency?", applied to every rule in the preset._ A user who passes it is choosing
alignment; the table above goes in `docs/presets.md` so which side moves is not a surprise.

**Rejected: splitting the field.** It doubles the surface to preserve a distinction the preset user
cannot see and did not ask for, and it makes the common case — "my team treats type imports as real
coupling everywhere" — require two options that must agree. The per-condition defaults remain the right
answer for someone holding a builder, where the distinction is visible and deliberate; a preset is the
layer at which it stops being visible.

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

- [Plan 0084](./0084-cycle-detection-that-ignores-type-only-imports.md),
  [0085](./0085-the-slice-graph-cannot-see-a-re-export.md),
  [0087](./0087-an-inline-type-import-still-requests-the-module.md) — the three changes preset
  users cannot respond to.
- `src/presets/layered.ts`, `src/presets/boundaries.ts`, `docs/upgrading.md`.

## Added 2026-08-07 — the declared-empty carrier

[ADR-009](../../adr/009-a-pass-is-constructed-from-evidence.md) part 3 makes this plan's mechanism binding
for a second reason: **every preset must expose a declaration carrier that reaches every check it
constructs.** Under [0098](./0098-the-evidence-seam-and-the-floor.md), a check that examined zero units
fails unless the author declared empty — and a preset user holds no builder, so without a carrier their
only reachable remedy is disabling the option, which deletes coverage permanently. That is ADR-008 rule
1's trained-suppression dynamic, produced by our own gate.

One shared option satisfies it; per-option unions do not generalise (`noInlineLogic` constructs many
rules from one entry, so a union cannot name which):

```ts
expectEmpty?: AgentGuardrailsRuleId[] // typed on the preset's own id union, like `overrides`
```

**An id that binds to no constructed rule is itself a failing configuration finding** — never a warning
(rule 1: a warning is invisible), through the existing unknown-`overrides`-key path. The silent version
turns an expiring assertion into nothing and makes 0098's remedy tell the user to add the option they
already added, misspelled: bug 0017's shape. It also buys rename protection, and makes the coupling
explicit — **preset rule ids become a declaration interface, so renaming one is a breaking change.**

This does not change 0089's priority or blast radius; it means 0098 depends on this plan, and the option
should be designed with that consumer in view.

## Outcome

**DONE.** Both phases plus the carrier, additive throughout — nothing changes if neither option is passed.

**The harder question was decided by measurement, not preference.** The asymmetry table above is why it
looked dangerous: whichever value is passed, exactly one side moves. It is not dangerous, because this
plan's own Problem section names alignment as the need, and splitting the field would have preserved the
disagreement the plan was filed to end.

**The carrier had to reach three construction paths, not one.** The presets build rules through the
shared `collectRule` (layered, boundaries, data-layer), through a local `push` helper
(agent-guardrails), and through an inline loop (recommended). A carrier wired into `collectRule` alone
would have looked complete, passed its tests, and covered a third of the surface — ADR-009's Context
table exactly. `tests/presets/declaration-carrier.test.ts` is therefore organised **by path rather than
by preset**, and each row names which path it proves.

**Constructed, not known.** An unbound-id finding checked against the preset's _known_ ids would accept
a declaration naming a rule the options never enabled. These presets construct conditionally, so known
and constructed differ by exactly the ids a declaration must not silently bind to — `collectRule` now
records what it built, threaded through the two helper layers in `layered` and `boundaries`.

**Two things the measurement corrected mid-build:**

- **A `.expectEmpty()` that is FALSE must fail**, and the first version of the test asserted the
  opposite. Declaring a rule empty over a corpus where it selects subjects is a false statement; the
  finding it produced was the carrier working, not a bug. The row now asserts both directions.
- **A dead glob is not declarable, and `strictBoundaries` proved it twice.** The first cross-preset probe
  showed the carrier "failing" there; measured, the finding was `preset/boundaries/discovery` — a
  config error from a glob that matches folders being handed a file. `.expectEmpty()` correctly does not
  clear it, and the distinction is now a test rather than a note.

**Phase 2's guard is the durable half.** The condition-to-preset map is derived from `src/presets/*.ts`
at test time; a hand-written list would rot the first time a preset gained a condition, and rot
silently, because a stale list still passes. It found **eight** rows scoped by a name a preset user never
types — including 0.47.0 and 0.48.0, the releases this plan was filed from.

### Sabotage: 7 rows, 7 caught

Green baseline both ends, every patch asserted to apply **and to typecheck**. Caught: the carrier as
identity; the carrier applied to every rule ignoring the list; unbound findings suppressed; unbound
checked against known rather than constructed ids; agent-guardrails losing the carrier on its own path;
`layered` dropping `importOptions` from layer order; `boundaries` dropping it from cycles.

The second row is the one worth keeping: applying the declaration to **every** rule regardless of the
list makes every "declared clears it" assertion pass. Only the one-of-four rows distinguish "the carrier
reached every rule" from "the carrier silenced everything".
