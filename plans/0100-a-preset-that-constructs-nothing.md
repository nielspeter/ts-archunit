# Plan 0100 — a preset that constructs nothing

**Status:** Open, PROPOSED — the design is not settled; see **What this has to decide**.
Filed 2026-08-08 from [0098](./0098-the-evidence-seam-and-the-floor.md)'s amendment, which measured that
the fail-closed floor cannot reach this.
**Depends on:** nothing structurally. Best decided alongside [0089](./0089-presets-forward-their-options.md),
which is the plan that already threads preset options.
**Priority:** Medium as a defect, **High as a claim**: [0099](./0099-the-floor-no-family-can-be-born-below.md)'s
release note says vacuity is unrepresentable, and this is the exception that has to be named in it. An
unqualified claim gets falsified by the first person who hits this, and burns the trust the whole programme
is spending.
**Effort:** Small once decided; the deciding is the work.
**Blast radius:** **Published API on the preset surface.** A preset that legitimately produces zero rules
would start failing. Middle row of [ADR-008](../adr/008-agent-first-failure-surfaces.md) rule 6 — prove the
detector fires for each preset and stop, unless the answer turns out to be a type change, which moves it up.

## Problem

Measured 2026-08-08, calling every published preset with **only the fields its own interface marks
required** — the minimal call the type system accepts:

| preset                | minimal call       | rules constructed |
| --------------------- | ------------------ | ----------------- |
| `agentGuardrails`     | `{ src }`          | **0 — silent**    |
| `dataLayerIsolation`  | `{ repositories }` | **0 — silent**    |
| `strictBoundaries`    | `{ folders }`      | 1                 |
| `layeredArchitecture` | `{ layers }`       | 2                 |
| `recommended`         | `{ src }`          | 4                 |

**Two of five, not one.** The vacuity matrix found `dataLayerIsolation` because its recipe happens to pass
only the required field; it missed `agentGuardrails` because that recipe adds `noCopyPaste: true`. So the
matrix measured a property of its own recipes, not of the presets — and the recipe that revealed the fault
was the one written with less care.

**The mechanism is the same in both, and it is the surface's shape rather than a preset's bug.** Every rule
sits behind an optional flag (`if (options.baseClass)`, `if (options.requireTypedErrors)`), while the
required field is only the **selector** that says where to look. Satisfying the interface completely
therefore enables nothing. A user who writes what the type demands gets a preset that constructs no rules
and says nothing about it.

The consumer writes the loop the docs teach —

```ts
for (const rule of dataLayerIsolation(project, opts)) rule.check()
```

— and it runs **zero times**. Every gate is green, the suite counts a preset as coverage, and the user
believes their data layer is guarded. This is bug 0066's shape exactly, one level up: `∀ over ∅` is true, and
the loop body is where the check lived.

`agentGuardrails` is the worse of the two, because it is the preset the agent-facing documentation leads
with — the one whose whole purpose is to be the guardrail an AI agent cannot talk its way past.

**Why the fail-closed programme does not catch it.** 0098 makes the evidence unforgettable in
`collectViolations()`'s **type**; 0099 acts on it at the **terminal root**. Both live inside a rule. A preset
is a function returning `TerminalBuilder[]`, and a function that returns `[]` never touches either
mechanism. The matrix records it as `'no-checks'` — a verdict distinct from `'fail-open'` precisely because
the authors of 0095 saw it was a different fault — and 0098 nevertheless promised to empty the list.

This is [ADR-009](../adr/009-a-pass-is-constructed-from-evidence.md)'s Context table happening to ADR-009:
four waves of vacuity guards, each closing its own enumeration, each followed by a family outside it. The
enumeration here was "families implementing the seam". A preset is not one.

## What this has to decide

Not settled, and the options are not equivalent:

- **Is zero rules ever legitimate?** `dataLayerIsolation` presumably returns `[]` when the options select
  nothing to guard. If that is a real state — a monorepo package with no repositories — then failing is
  wrong and the answer is a **declaration**, which needs 0089's option threading to be expressible. If it is
  never legitimate, the preset is simply wrong and the fix is in the preset.
- **Where does the check live?** Three candidates, in increasing order of how much they cost and how much
  they buy: (a) each preset asserts its own non-emptiness — cheapest, and forgettable, which is the property
  this programme exists to remove; (b) a shared `preset()` wrapper every preset returns through, so the
  invariant is structural the way 0098's return type is; (c) the preset signature returns a
  `PresetResult { rules, examined }` mirroring `CollectResult` — most consistent, and a published-API break
  on every preset.
- **What is the user-facing surface?** A preset returning `[]` has no rule to attach a violation to, so
  there is no `check()` to fail. It has to fail where the preset is _called_, or `diagnose()` has to learn
  about presets. Those are different products.
- **Does `layeredArchitecture` with one layer have the same shape?** Not measured. A preset that constructs
  _fewer_ rules than its options imply is the same fault with a harder detector, and the answer changes
  whether (a) is even viable.
- **Is "required field = selector, rules = optional flags" the right shape at all?** Both silent presets have
  it. If enabling at least one rule were a **type** requirement — a required union, or the flags moved out of
  the optional bag — the fault would be unrepresentable rather than detected, which is the move ADR-009 makes
  everywhere else. That is a bigger break than (a)–(c) and may be the honest answer.

## Not measured

- **The rest of the option space.** Five presets were measured at exactly **one** point each — the minimal
  type-correct call. Two were silent there. Nothing was measured about intermediate combinations, and
  `strictBoundaries` at `{ folders }` constructing 1 rule says nothing about `{ folders, someFlag: false }`.
  The honest statement is that two presets are known to be silent at one measured point, not that the other
  three are safe.
- Whether a user's own preset-shaped helper — the pattern `docs/presets.md` teaches — has the same hole. It
  does by construction, which is an argument for (b) or (c) over (a).

## Out of scope

Everything the per-rule floor already covers ([0099](./0099-the-floor-no-family-can-be-born-below.md)).
