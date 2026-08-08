# Plan 0100 — a preset that constructs nothing

**Status:** Open, PROPOSED — the design is not settled; see **What this has to decide**.
Filed 2026-08-08 from [0098](./completed/0098-the-evidence-seam-and-the-floor.md)'s amendment, which measured that
the fail-closed floor cannot reach this.
**Depends on:** nothing structurally, but **coupled to 0099's release**: if this lands first, 0099's
claim drops its qualifier; if after, the changelog ships a named exception. Best decided alongside
[0089](./completed/0089-presets-forward-their-options.md), which already threads preset options.
**Priority:** Medium as a defect, **High as a claim**: [0099](./0099-the-floor-no-family-can-be-born-below.md)'s
release note says vacuity is unrepresentable, and this is the exception that has to be named in it. An
unqualified claim gets falsified by the first person who hits this, and burns the trust the whole programme
is spending.
**Effort:** Small. Review resolved most of the deciding: (b) is the shape, `overrideFindings()` is the
precedent, and the legitimate-zero case is the one real constraint.
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

**The decisive measurement is not the empty corpus — it is a corpus with real violations.** An empty
fixture proves nothing here: of course a preset finds nothing in nothing. Run the option lattice against
`tests/fixtures/presets/agent-guardrails`, which holds genuine findings:

| options passed (always with `src`)       | rules | violations |
| ---------------------------------------- | ----- | ---------- |
| _(none — the minimal type-correct call)_ | **0** | **0**      |
| `noInlineLogic: ['parseInt']`            | 1     | 1          |
| `noGenericErrors: true`                  | 1     | 1          |
| `noStubs: true`                          | 1     | 1          |
| `noEmptyBodies: true`                    | 1     | 2          |
| `noCopyPaste: true`                      | 1     | 1          |
| all five                                 | 5     | **6**      |

**On a corpus where this preset finds six real violations, the minimal call reports zero and passes
green.** `dataLayerIsolation` is the same shape (0 → 2 violations once flagged). And `{src}` yields zero
rules on **every** corpus measured — 0, 5 and 6 files — so this is a property of the option surface, not
an artifact of the input.

**The mechanism is the same in both, and it is the surface's shape rather than a preset's bug.** Every rule
sits behind an optional flag (`if (options.baseClass)`, `if (options.requireTypedErrors)`), while the
required field is only the **selector** that says where to look. Satisfying the interface completely
therefore enables nothing. A user who writes what the type demands gets a preset that constructs no rules
and says nothing about it.

**The docs are not the argument — they lead users AWAY from this.** `docs/presets.md` says plainly
_"Both rules are optional — omit `baseClass` to skip the extension check, omit `requireTypedErrors` to
skip the error check"_, and every published example passes flags. An earlier draft of this plan claimed
the docs teach this call; that is true of the loop and **false of the options**, and a reviewer who
checks discounts the whole finding on that sentence. The two paths that actually reach it are narrower
and matter more:

1. **An agent generating from the published `.d.ts`.** `AgentGuardrailsOptions` marks `src: string`
   required and everything else optional, so the minimal type-correct call is exactly what a generator
   emits. ADR-008 and ADR-009 both open by naming the primary consumer as an AI agent — and
   `agentGuardrails` is the preset whose whole purpose is to be the guardrail that agent cannot talk
   its way past.
2. **Incremental adoption** — "wire the preset now, enable the flags next sprint." Silent, and common.

The loop itself the docs do teach —

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
- **Zero rules is ALREADY legitimate, today.** `overrides: { '<every id>': 'off' }` produces zero rules
  by documented design, measured. So the question above is answered — yes — and any non-emptiness check
  must distinguish **"no rule was ever enabled"** (a mistake) from **"every enabled rule was explicitly
  turned off"** (a declaration). That is the same distinction the floor draws between zero-subjects and
  declared-empty, which is a strong hint about the right layer.
- **Rule count is not a proxy for "the preset does something."** Measured: `layeredArchitecture` with
  `{ layers: {} }` — the emptiest config the type accepts — constructs **2 rules** on every corpus, and
  a one-layer call constructs the same 2. Neither enforces anything about layering. Any fix that counts
  rules scores these healthy. This kills option (a) as a general answer rather than merely weakening it.
- **Where does the check live?** Three candidates, in increasing order of how much they cost and how much
  they buy: (a) each preset asserts its own non-emptiness — cheapest, forgettable, and killed by the
  rule-count measurement above; (b) a shared `preset()` wrapper every preset returns through, so the
  invariant is structural the way 0098's return type is; (c) the preset signature returns a
  `PresetResult { rules, examined }` mirroring `CollectResult` — a published-API break on every preset,
  and the field names would lie, since at preset level "examined" means _rules constructed_, not units
  examined. Two different quantities under one name, inside a programme whose entire value is that its
  counts mean something.

  **(b) is the answer, and the precedent already ships.** `overrideFindings()` (`src/presets/shared.ts`)
  **already returns builders carrying configuration findings**, spread ahead of the real rules by every
  preset. A wrapper that appends a config-finding builder when the rule list is empty is that same
  mechanism: non-breaking (still `RuleBuilderLike[]`), structural, and it dissolves this plan's own open
  question below — a preset returning `[]` has nothing to attach a violation to, so the wrapper
  manufactures one. Nothing needs to fail at call time and `diagnose()` needs no knowledge of presets.

- **What is the user-facing surface?** A preset returning `[]` has no rule to attach a violation to, so
  there is no `check()` to fail. It has to fail where the preset is _called_, or `diagnose()` has to learn
  about presets. Those are different products.
- **`layeredArchitecture` with one layer — now measured, and it decided the option.** One layer builds
  2 rules; `{ layers: {} }` builds 2 rules; two layers build 2 rules. Rule count carries no information
  about whether the preset enforces anything, which is what rules (a) out. What remains unmeasured is
  the _harder_ detector this implies: a preset constructing fewer rules than its options imply.
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
- Whether a user's own preset-shaped helper has the same hole. It does by construction — but an earlier
  draft cited "the pattern `docs/presets.md` teaches", and **no such doc exists**: that file teaches
  _consuming_ our presets and composing them with custom rules, not authoring one. The sentence was
  load-bearing for choosing (b) over (a) and is withdrawn; (b) stands on the `overrideFindings()`
  precedent without it. Whether to write the authoring guide is a separate question.

## Out of scope

Everything the per-rule floor already covers ([0099](./0099-the-floor-no-family-can-be-born-below.md)).
