# Why ts-archunit — architecture governance for the AI era

This is the positioning rationale behind ts-archunit: what problem it exists to solve, why that problem is getting worse, and precisely where the tool fits among the alternatives. The API and how-to live elsewhere ([Getting Started](https://nielspeter.github.io/ts-archunit/getting-started)); this document is the _why_.

## The problem, restated for dark factories

Software complexity rises over time unless deliberate work is spent to counter it — **Lehman's law of increasing complexity**, the mechanism behind the "big ball of mud." Historically the countering work was human: code review and refactoring by someone who held the team's pattern inventory in their head and noticed when a new PR diverged from it.

AI coding agents break that arrangement in two ways. They raise the _rate_ of change past what human review can absorb, and they remove the human who held the inventory. The result is not hypothetical — the field is now reporting it with numbers:

- AI's initial **3–5× productivity boost dissipates within ~3 months** as security, maintainability, reliability, and complexity debt accrue as fast as the code (a Carnegie Mellon study, cited by Sonar's Tariq Shaukat).
- **Commits rose 25% while review comments fell 27%** in the same year; median PR review time is up ~5×, and **31% more PRs now merge with no review at all** (GitHub / Faros AI, via eBay's "ReviewDebt" framework).
- An **agent architecture has a half-life of ~6 months** (Dan Farrelly, Inngest) — and the same clock applies to governance you encode as prose: prompts last weeks, models months.
- Agents produce _"**dark code that passes tests but undermines implicit architectural constraints**"_ (Katie Roberts, NearForm) — and brownfield systems, where this compounds, are 60–70% of enterprise software.

(Vendor case-study figures — e.g. "92% fewer issues" — are single-customer and should be read as marketing, not evidence. The Carnegie Mellon and GitHub/Faros figures are the credible anchors.)

The common thread: **an agent optimises for a green build and has no reward signal for architecture.** The only durable governor is a signal that turns architecture into the thing the agent already reacts to — a failing check.

## Where ts-archunit fits

The clearest map is Birgitta Böckeler's (ThoughtWorks): the machinery around a coding agent is **guides** (feed-forward: conventions, instructions) and **sensors** (feedback: linters, static analysis, review agents), and each is either **computational** (CPU, deterministic) or **inferential** (LLM-judged).

|                   | Guide (feed-forward)                  | Sensor (feedback)                         |
| ----------------- | ------------------------------------- | ----------------------------------------- |
| **Computational** | rules as machine-readable constraints | **← ts-archunit** (static, deterministic) |
| **Inferential**   | prompt / `CLAUDE.md` conventions      | LLM review agents                         |

ts-archunit is the **computational sensor** — and, via `explain --format agent`, a nascent computational guide. Two adjacent tools occupy the other cells, and neither fills ts-archunit's:

- **SonarQube and other scanners** are computational, but verify a **fixed catalog** — generic quality, security, complexity, duplication. They cannot be taught _your_ invariants ("repositories extend `BaseRepository`", "every route has a permission-matrix entry", "no service holds a `Knex`").
- **LLM review agents** can judge intent, but their verdict is **non-deterministic**.
- **dependency-cruiser / eslint-plugin-boundaries / ts-arch** are computational and yours-to-configure, but see **only the import graph** — never inside a function body.

The cell only ts-archunit occupies: **cross-file × your team's architecture × inside the function body × deterministic.**

## Why deterministic is the point

The insistence on a _computational_ gate — not an LLM judge — is not a ts-archunit idiosyncrasy. Four independent sources converge on it:

- **Böckeler (ThoughtWorks):** _"You don't want the green/red state of your pipeline to depend on the semantic interpretation of an LLM."_
- **Shaukat (Sonar):** verification must fuse an **algorithmic** layer (data/control flow, known patterns) with the agentic one; the algorithmic layer is what you trust.
- **Gupta (eBay):** scoring must be _"traceable to deterministic computation"_ — an LLM judge is _"a moving target"_ (same input, different score as the model changes) and _"not defensible in a leadership review."_
- **Farrelly (Inngest):** durability comes from decoupling the stable layer from the volatile ones.

Two consequences for ts-archunit specifically:

1. **A rule is defensible.** Its verdict is reproducible and explainable, so it can gate CI and survive a leadership conversation.
2. **A rule has a long half-life.** An architectural intent written into a prompt or `CLAUDE.md` decays with the model (weeks–months). The same intent as a deterministic rule survives model, prompt, and framework churn. Encoding an invariant once, mechanically, is how it stops rotting.

## The lineage

ts-archunit is an **architectural fitness function** (Ford, Parsons & Kua, _Building Evolutionary Architectures_) — an automated, objective check that an architectural characteristic holds. Java's [ArchUnit](https://www.archunit.org/) is the canonical example; ts-archunit brings the idea to TypeScript and extends it past the import graph into function bodies, type shapes, cross-file consistency, and correspondence.

## What this demands of the tool (the honest part)

Being the right _category_ of answer is not enough; a fitness function only earns the "gatekeeper" role if it keeps earning it. Four conditions, each a live concern in this project:

1. **The gate must be un-gameable.** A rule keyed on a name (`*Service`) or a token (`parseInt`) is routed around the moment the agent renames or relocates. Prefer structural/behavioural selectors, and make findings **fail** (not warn), carry their remedy, and be non-vacuous. See [ADR-008](../adr/008-agent-first-failure-surfaces.md).
2. **The discovery half must be first-class.** A rule only catches what someone foresaw; large-codebase collapse is mostly _un-ruled_ drift. Duplicate-body and inconsistent-sibling detection are the "forensic archaeology" for what no rule names yet.
3. **It is a governor, not a designer.** A fitness function makes good decisions _stick_ — it ratchets and blocks regression. It does not produce the architecture. That still comes from humans, ADRs, and planning.
4. **It needs an owner and a feedback loop.** Per Patrick Debois, guardrails are _"improve the system, not the code"_ and are born from the retro: when the agent repeatedly makes a mistake, encode a rule so it can't again. A sensor whose findings nobody triages is theatre — which is why adoption wants a baseline/ratchet and a team that owns the ruleset.

## Sources

- Birgitta Böckeler (ThoughtWorks) — _State of Play: AI Coding Assistants_ (the guide/sensor × computational/inferential model).
- Tariq Shaukat (Sonar) — _In the Land of AI Agents, the Verifiers Are King_ (verification as the moat; the CMU dissipation study).
- Sachin Gupta (eBay) — _ReviewDebt: scoring every pull request_ (review debt; deterministic-not-LLM scoring).
- Dan Farrelly (Inngest) — _Your agent architecture has a half-life of 6 months_ (decoupling volatile from durable layers).
- Katie Roberts (NearForm) — _Stop Maintaining, Start Evolving_ (brownfield; "dark code that passes tests").
- Patrick Debois — _The DevOps Godfather on AI's Dark Factory Problem_ (organisational readiness; improve the system).
- Dex Horthy (HumanLayer) — _Harness Engineering is not Enough_ (the training-reward gap).
- Foundational: Lehman's laws of software evolution; Foote & Yoder, _Big Ball of Mud_; Ford, Parsons & Kua, _Building Evolutionary Architectures_.
