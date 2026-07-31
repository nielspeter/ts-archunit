# Setup & Best Practices

How to roll ts-archunit out on a real project without drowning in violations or fighting the tool. The short version: start with a thin floor, add shape-specific rules gradually, baseline before you gate CI, and save project-specific custom rules for last.

## The adoption ladder

Add rules in this order. Each rung is safe to stop on.

1. **Floor** — `npx ts-archunit init` gives you [`recommended`](/presets#recommended): a handful of universally-dangerous checks that fire on almost no healthy code. This is your green baseline.
2. **Shape** — add a [preset](/presets) that matches your architecture: `layeredArchitecture` for layers, `strictBoundaries` for feature modules, `dataLayerIsolation` for the repository pattern. One function call, several coordinated rules — spread it into `arch.rules.ts` alongside the floor: `export default [...recommended(p), ...layeredArchitecture(p, { layers })]`.
3. **Baseline** — on an existing codebase, run `npm run arch:baseline` and commit `arch-baseline.json` so only _new_ violations fail. See [Adopting on existing code](#adopting-on-an-existing-codebase).
4. **CI** — wire `npx ts-archunit check --format github` into your PR pipeline (see [Getting Started](/getting-started)). Only gate CI _after_ the baseline is committed.
5. **Custom rules — last** — encode the conventions specific to your team with [`definePredicate` / `defineCondition`](/custom-rules). These are the highest-value rules, but they're also the ones only you can write, so add them once the scaffolding is stable.

## Severity: error vs warn

Every rule is an **error** by default — a violation fails the run (and CI). Mark a rule as a non-failing **warning** with the non-terminal `.asSeverity('warn')` — with one exception ([configuration findings](/violation-reporting#the-one-thing-warn-cannot-silence)):

```typescript
export default [
  ...recommended(p),
  functions(p)
    .that()
    .resideInFile('**/src/**')
    .should()
    .satisfy(noEmptyBodies())
    .asSeverity('warn'),
]
```

`check` exits non-zero only when there are **error**-severity violations; warnings are reported but never fail the build. Use `warn` for rules with legitimate exceptions (best-effort cleanup, no-op callbacks) or for a rule you're rolling out gradually before promoting it to `error`.

## Enforce your compiler options upstream

Every code-level rule assumes your TypeScript strict flags are on. Nothing stops a teammate from flipping `strict: false` to make `tsc` green — your rules keep passing because they inspect code `tsc` already let slide. Close that hole with [`tsconfig()`](/config-rules):

```typescript
export default [
  tsconfig(p).requires({ strict: true, noUncheckedIndexedAccess: true }),
  ...recommended(p),
]
```

## Adopting on an existing codebase

The empty baseline that `init` creates does **not** protect the first run — it's a placeholder. `recommended` ships error rules (`no-eval`, `no-function-constructor`) that will fail on legacy code. So on any non-trivial existing project:

```bash
npm run arch:baseline   # snapshot current violations as accepted legacy debt
git add arch-baseline.json && git commit
# only NOW gate CI on `npm run arch`
```

As you fix legacy violations, regenerate the baseline to ratchet down — it can only shrink.

### Enforcing the ratchet

"It can only shrink" is a convention until something checks it. Nothing stops a red PR being
turned green by regenerating the baseline, and a violation accepted a year ago and one accepted
ten minutes ago look identical in the file.

Compare the baseline against **the base branch**, not against the working tree — and give the
job enough history to do it:

```yaml
# .github/workflows/arch.yml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0 # required: the default shallow checkout has no base to diff against
```

```bash
git diff --exit-code "origin/$GITHUB_BASE_REF...HEAD" -- arch-baseline.json
```

Three ways to get this wrong, all of which have shipped in this document at some point and all
of which were caught by running them:

- **`git diff --exit-code arch-baseline.json`** with no ref compares the **working tree to the
  index**. A CI checkout is clean, so it exits 0 no matter what the PR did — a gate that cannot
  fail.
- **`git fetch --depth=1 origin "$GITHUB_BASE_REF"`** does not create `origin/<branch>`; a plain
  `git fetch <remote> <branch>` only updates `FETCH_HEAD`. The diff line then dies with
  `fatal: bad revision` and **exit 128**, which a shell treats as failure — so it fails every PR
  instead of none. Verified.
- **`...` on a shallow clone** has no merge base. Either use `fetch-depth: 0` as above, or fetch
  with an explicit refspec and use the two-dot form:
  `git fetch --depth=1 origin "$GITHUB_BASE_REF:refs/remotes/origin/$GITHUB_BASE_REF"` then
  `git diff --exit-code "origin/$GITHUB_BASE_REF" HEAD -- arch-baseline.json`.

That rejects **any** change to the baseline, including a legitimate ratchet-down and a
same-content refresh — `generateBaseline` stamps `generatedAt`, so re-running it always rewrites
the file. Treat a failure as "explain this in review", not as "never touch it", and see the
exceptions below.

For a gate that allows shrinking, use the delta `generateBaseline` returns. It **overwrites the
file before it returns**, so run it against a copy — pointing it at a scratch path directly
would find no prior baseline and report every entry as new:

```ts
import fs from 'node:fs'
import { generateBaseline } from '@nielspeter/ts-archunit'

// Copy first: generateBaseline OVERWRITES its output before returning the delta,
// so running it against the real file accepts the growth and then complains.
fs.copyFileSync('arch-baseline.json', '.arch-baseline.check.json')
const delta = generateBaseline(violations, '.arch-baseline.check.json')

// `added` counts identities, and two findings can share one — so a PR that adds a
// duplicate of an accepted violation has `added === 0`. Compare the count as well.
const grew = delta.added > 0 || (delta.before !== undefined && delta.after > delta.before)
if (grew) {
  console.error(`Baseline grew: ${String(delta.before)} -> ${String(delta.after)}`)
  process.exit(1)
}
```

**The delta gate cannot see a metric regression.** Metric identities are deliberately
value-free since 0.31.0, so a class growing from 8 methods to 12 changes no hash and the delta
is `(+0, −0)`. `check` still catches it — `isKnown` compares the measurement — so run this
**in addition to** `check`, never instead. Measured.

`violations` is the array your rules produce — `rules.flatMap((rule) => rule.violations())` over
the builders you would otherwise pass to `checkAll`. This is a script you run with `tsx`, not a
built-in flag.

**Two cases where the gate is wrong and you must let the change through** (a third, the metric rules, was fixed in 0.31.0):

- **An upgrade.** [Upgrading](/upgrading) tells you to refresh the baseline before several
  releases, and 0.29.0's identity change rewrites every entry. The gate will fire on exactly the
  commit the upgrade instructions asked for.
- **A rule whose description changed.** The tool's own remedy for that finding is "regenerate the
  baseline", which the gate forbids.
- ~~**The metric rules.**~~ **Fixed in 0.31.0.** `maxMethods` and friends used to put the measured
  value in the message, so a class going from 10 methods to 8 counted as a _new_ finding and
  improving the code failed the gate —
  [bug 0012](https://github.com/NielsPeter/ts-archunit/blob/main/bugs/fixed/0012-metric-findings-have-no-usable-ratchet.md).
  They now ratchet per element: the baseline records the accepted measurement, improving stays
  green, and only a regression past that value fails. Note the accepted value tightens when you
  regenerate and not before, so a class baselined at 10 that improves to 8 may regrow to 10
  without failing.

Agree a convention for these — a commit-message marker, a label, a skip path — before you turn
the gate on. And run it **in addition to** `check`, never instead: the baseline deliberately
excludes configuration findings, so a job that only diffs the baseline never sees a dead glob or
an empty selector.

A baselined violation is identified by its content, not by where it sits: the rule, the element and the message, with the repository root normalised out of all three. Some rules supply their own canonical identity where the message would otherwise be unstable — a duplicate pair is identified by its two endpoints regardless of which is reported first, and a per-occurrence finding by its enclosing declaration rather than its line number. The baseline records where the repository root sat relative to itself, so the file matches on any machine and in any CI checkout, whatever the directory is called.

Two things still change identity, by design and by omission:

- **By design** — renaming the element, rewording `.because()`, or changing the rule's own configuration. The finding should be re-reviewed.
- **By design, and now ratcheted** — the size and complexity metrics (`maxMethods`,
  `maxClassLines`, `maxParameters`, `haveMaxExports` and their siblings) put the measured value in
  the message, but since 0.31.0 they are identified by element and metric and the baseline records
  the accepted measurement. Improving a class from 10 methods to 8 stays green; growing past 10
  fails. The accepted value only tightens on regeneration.

## Suppressing individual violations

Baseline is for _"accept this legacy debt for now."_ For a _permanent, intentional_ exception, use `.excluding()` on the rule itself — and match on the right thing:

| You want to exclude by… | Pass to `.excluding()`             | Example                      |
| ----------------------- | ---------------------------------- | ---------------------------- |
| Element name            | the qualified name (string/RegExp) | `'OrderService.legacyParse'` |
| File path               | a path glob                        | `'**/legacy/**'`             |
| A specific message      | a RegExp against the message       | `/parseInt/`                 |

`.excluding()` warns if a pattern matches nothing (a stale exclusion). Wrap a pattern in `silent()` to suppress that warning when you know the exclusion is forward-looking. Rule of thumb: **baseline for temporary debt, `.excluding()` for permanent by-design exceptions.**

## Monorepos

Use [`workspace()`](/core-concepts#monorepo-workspace) to unify the import graph across packages so cross-package imports are visible to dependency rules:

```typescript
const ws = workspace(['apps/web/tsconfig.json', 'packages/shared/tsconfig.json'])
```

`workspace()` uses the alphabetically-first tsconfig's compiler options. For per-package strictness (a `tsconfig()` rule against one package), load that package directly: `tsconfig(project('./packages/x/tsconfig.json'))`.

## AI-agent projects

If AI agents write code in your repo, add the [`agentGuardrails`](/presets#agentguardrails) preset and feed `explain --format agent` into the agent's instructions — see the [AI Agents](/ai-agents) workflow. The guardrails catch the mistakes agents make most; the check-in-loop lets the agent self-correct.

## Anti-patterns

- **Don't start with 50 rules.** A wall of red on day one gets the tool disabled. Floor first, then grow.
- **Don't gate CI before baselining an existing codebase.** The first PR will fail on legacy code nobody touched.
- **Don't put project-specific rules in a preset.** Presets are generic and shared; your `"OrderService must call the pricing gateway"` rule belongs in `arch.rules.ts`, not a reusable preset.
- **Don't reach for `.excluding()` when you mean baseline.** Excluding a violation forever hides real regressions in that spot; baseline lets new ones surface.
