# Proposal 025 — Rule-Impact Telemetry (the defensible-ROI surface)

**Status:** Draft 1 — external origin (2026-08-08). **Not yet architect/product reviewed.** Authored from outside `src/`; verify surface claims before acting.
**Priority:** Medium — low-risk, and it is what makes [proposal 024](./024-english-invariant-authoring-on-ramp.md)'s rules _defensible_. A platform team that cannot answer "what did the guardrails buy" loses its budget in a cost-reset year; this gives them a number that is honest.
**Affects:** An aggregation layer over the **existing** `check --format json` output (`plans/completed/0019-output-formats.md`, `0044`) + an opt-in local run-log + a `report` (or `stats`) read surface. **No network, no phone-home, no new runtime dependency** (ADR-001). No engine change.
**Depends on:** `0019`/`0044` (structured violation output — the raw material); the baseline/diff machinery (`plans/completed/0016-baseline-diff-aware.md`) which already distinguishes _new_ from _pre-existing_ violations — the one signal that is genuinely measurable.
**Origin:** Field-report finding. Debois's "multiplier" is the metric practitioners say is _easier to defend to a VP than productivity_: _"you fix something once, everybody gets the benefit."_ Today ts-archunit emits per-run violations but nothing that accumulates into per-rule impact over time.

> **This proposal's hardest constraint is honesty, not engineering.** ts-archunit sells against false-greens ([ADR-008](../adr/008-agent-first-failure-surfaces.md)). A telemetry surface that claims "this rule saved 340 agent turns" as a _measured fact_ would be the same sin: turns-prevented is a **counterfactual**, not an observation. The design below draws a hard line between what is _measured_ and what is _estimated_, and never lets the second wear the clothes of the first.

## Problem

The report ranks "instrument the ROI metric" as a genuine gap: nobody in the space publishes per-rule impact, and ts-archunit's `rules/metrics` module is _code_ metrics (complexity, lines, params) — not _rule_-impact. So an adopter can enforce 177 rules and still be unable to answer the only question leadership asks: **which of these earned their keep?** Without that, the guardrail investment is unaccountable, and in a "the bill came due" climate, unaccountable loses.

## The honesty line — measured vs estimated

**Directly measurable (ship these as facts):**

- **Fires per rule, over time** — how often each rule id reports a violation across runs. Aggregated from the JSON you already emit.
- **New vs. pre-existing** — the baseline/diff layer (`0016`) already knows which violations are _newly introduced_ vs grandfathered. "Rule R blocked N _new_ violations this month" is a real, defensible number.
- **In-loop fires** — violations surfaced during the agent's `check --format json` loop (`0044`) vs. at CI. "R fired in-loop M times" measures steering actually happening.
- **Baseline burn-down** — the ratchet's monotonic decrease per rule.

**Estimated, never asserted as fact (label explicitly, show the formula):**

- **"Turns / human-touches prevented."** This is Debois's multiplier and the VP-legible line — but it is a _model_, not a measurement (you cannot observe the turn that didn't happen). If shown at all, it must be rendered as `estimated ≈ (new violations blocked) × (assumed turns per violation)` with the assumed factor **visible and configurable**, flagged `estimated`, and never emitted in the same field or format as a measured count.

Getting this line right is the whole proposal. It is also, not incidentally, a proof point: _the tool that refuses to fake its own ROI is the tool you trust to refuse a false-green._

## Design

1. **Opt-in local run-log.** On `check`, if telemetry is enabled (config flag; **off by default**), append a compact record per run: timestamp (from the run, not `Date.now()` in a way that breaks determinism — a run-stamp), per-rule `{id, fires, newFires, inLoop}`. Local file (`.ts-archunit/impact.jsonl` or similar), git-ignored, never transmitted.
2. **`ts-archunit report`** (read-only): aggregates the run-log into per-rule impact — total fires, new-blocked, in-loop share, trend, baseline burn-down — sorted by new-blocked (the rules earning their keep float up; rules that never fire surface as candidates for `doctor`/removal, tying to the vacuity work `0098`).
3. **The estimated line**, clearly quarantined: one optional summary row, `estimated turns saved ≈ …`, formula shown, factor configurable, `estimated` tag inline. Omitted entirely unless the user opts in.
4. **Machine-readable** (`report --format json`) so a platform team can pipe it to their own dashboard — the dashboard is _theirs_, ts-archunit does not become analytics-as-a-service.

## Why it fits

- Rides the JSON surface (`0019`/`0044`) and the new-vs-existing signal (`0016`) that already exist — it is aggregation, not new instrumentation.
- Surfaces the **Discovery** angle for free: rules that never fire are exactly the un-earning rules `doctor` and the `0098` vacuity work care about; impact telemetry and vacuity detection look at the same data from opposite ends.
- It is the accountability half of proposal 024: `add` makes rules cheap to write; `report` shows which of them mattered, so the rule set curates itself instead of only growing.

## Non-goals / risks

- **Not analytics-as-a-service, not telemetry-home.** Local, opt-in, silent by default. Any hint of phone-home would violate both ADR-001's minimalism and the trust the tool trades on.
- **Not a productivity claim.** The measured numbers are about _rule fires_, not developer output. The estimated turns line is explicitly a model; if reviewers judge even a well-labeled estimate too risky for the anti-false-green brand, ship only the measured surface — it stands on its own.
- **Determinism:** the run-log must not make `check` non-deterministic or timing-dependent in a way that affects rule outcomes; telemetry is a side output, never an input to evaluation.

## Acceptance

- `check` with telemetry on appends a per-run, per-rule record locally; off by default; nothing leaves the machine.
- `ts-archunit report` aggregates fires / new-blocked / in-loop / trend per rule, and `--format json`.
- Any "turns saved" output is tagged `estimated`, shows its formula, and is never co-mingled with measured counts; default off.
- No new runtime dependency; no network; `check` outcomes unchanged with telemetry on or off.

## Open questions for review

- Is a per-run local log the right substrate, or should it piggyback on the baseline file's regeneration cadence?
- Should the estimated-turns line exist at all, or is the measured "new violations blocked per rule" enough of a VP story on its own? (My lean: ship measured-only first; add the estimate behind a flag later, if ever.)
- Does "rules that never fire" belong in `report` or in `doctor`? They are the same finding from two directions — pick one home to avoid divergence.
