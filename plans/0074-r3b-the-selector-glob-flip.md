# Plan 0074 — R3b: the selector glob flip

**Status:** GATE OPEN as of gate run 4 (2026-07-31), behind bugs 0031 and 0032. Previously DESIGNED, GATED. Split out of [plan 0069](./completed/0069-no-rule-may-certify-nothing.md)
on 2026-07-30 so that a 90%-shipped plan stops being held open by one slice waiting on a
precondition that does not exist yet. Nothing here is undecided — the design and both open
decisions are settled in 0069 and [its appendix](./completed/0069-appendix-vacuous-tests.md).
**Priority:** High. Startable once bugs 0031 and 0032 are fixed — they are corrections to the
messages R3b converts into build failures, so they come first.
**Breaking.** A dead selector glob becomes a hard failure, so it reds on globs the adopting
team wrote.

## What it is

A selector glob that cannot match anything in the project becomes a configuration finding
rather than a silent pass, plus `emptyIsPass`. The machinery it needs shipped in R2a
(v0.20.0): `GlobNode`/`GlobSite`, `PathUniverse`, `glob-diagnosis`, combinator propagation,
and `doctor`. What remains is the **flip** — turning a `doctor` diagnostic into a check-time
failure — and `emptyIsPass`.

0069's decision table governs which positions flip, and it is not reopened here:

| position    | polarity | Unsatisfiable ⇒                                                         |
| ----------- | -------- | ----------------------------------------------------------------------- |
| `selector`  | positive | **fault** — the rule can never have subjects                            |
| `selector`  | negative | **no fault** — over-selects                                             |
| `discovery` | —        | **fault** — shipped already (0067-D)                                    |
| `condition` | positive | **no fault** — but see the `only*` exposure (0069 line 205, bug 0015)   |
| `condition` | negative | **no fault** — indistinguishable from an armed tripwire                 |
| `exclusion` | —        | **never** — proposal 006: an exclusion matching zero is remedy-optional |

The two `condition` rows are the ones [plan 0072](./0072-a-denylist-glob-that-cannot-match.md)
re-opened and got wrong twice. They stay as written.

## The gate, and why it is not closeable here

0069's own condition:

> **R3b does not ship until** the adopting codebase has run R2a's pre-flight and its findings
> have been classified by remedy.

The registered decision rule is: **does any finding's message assert a cause that is wrong
for that input?**

**Gate run 1** — this repository. **Gate run 2** — `dotansimha/graphql-code-generator`, chosen
sight-unseen, 215 `.ts` files: verdict "pass, with that amendment", but explicitly narrow,
because that repo carries no ts-archunit rules, so what it classified was absent directories
rather than rule-site findings.

**Gate run 3, 2026-07-30 — dogfooding, refuted.** `spikes/0069-gate-walk.mjs` across all 34
fixture projects plus the root:

```
33 of 34 fixture projects   absent=0   excludedByConfig=0   noTypeScript=0
root project                absent=35  excludedByConfig=3   noTypeScript=32
tests/fixtures/graphql      absent=1   excludedByConfig=0   noTypeScript=1
```

The fixture corpus is vacuous — fixtures are minimal by construction, so 33 of them produce
nothing to classify. Of the 36 absent directories that exist, 33 are `.claude/…` and
`schema/`, where "contains no TypeScript" is trivially correct. Only 3 are interesting and
they come from the root project, which is the population the gate excludes.

Note the exclusion's _stated_ reason was also wrong and is corrected in 0069:
`arch-rules.test.ts` predates the plan by four months, so the sites are not uniformly
curated. The binding constraint turned out to be **size**, not curation.

**What the gate still needs — restated by [plan 0077](./completed/0077-doctor-promote-it.md).** The
original wording demanded "a loadable `arch.rules.ts`, not a vitest test file". That constraint
belongs to `doctor`'s **loader**, not to the diagnosis: `diagnose()` is handed rules, so it runs
wherever they are built, including inside a test file. So the gate is:

> Run the pre-flight over a real adopting codebase — `doctor` for a CLI-shaped project,
> `diagnose(rules)` for a test-hosted one — and classify each finding against the decision rule
> above, recording the population.

The original claim that "neither `doctor` nor `diagnose()` can reach them" is wrong about
`diagnose()` and was what kept this plan parked. What this repository actually needs is to
**collect** its 43 rules — they are built inside `it()` callbacks and never returned — which is a
test-authoring change, not a tool limitation.

That removes the **host** constraint. It does not remove the gate: there has to be a **non-empty**
finding population before there is anything to classify.

## Gate run 4, 2026-07-31 — the gate opens, with two amendments

Two halves: this repository's own rules, and a real codebase adopting the shipped package.

**Half A — this repository. Refuted, for the fourth time, now at the rule-site level.** The 36
rules in `tests/archunit/arch-rules.test.ts` are collected as values (`gate()`) and handed to
`diagnose()`. **Zero findings.** The population here is 36, not the 43 this plan and the roadmap
both said — 41 `it()` blocks, five of them the file's own meta-guards. A green suite under its own
rules produces nothing to classify, which is what the three earlier runs kept discovering by other
routes. The collection is worth keeping regardless: it closes the residual the file's source-text
glob scan names in its own comment, and the guard now carries a control, because zero findings is
also what a broken `diagnose()` returns.

**Half B — `honojs/hono` @ `51db313` (v4.12.33), 186 non-test `.ts` under `src/`.** Chosen
sight-unseen; not this repository, not gate run 2's, not the fixture corpus. Installed the
**published** `@nielspeter/ts-archunit@0.32.0` from npm, ran `ts-archunit init --preset layered`,
and diagnosed the scaffold **unedited** — the documented default path in its ordinary first-run
state, which is exactly the population R3b exists to act on.

| population                                 | findings | shape                                    |
| ------------------------------------------ | -------- | ---------------------------------------- |
| A: root `tsconfig.json` (solution-style)   | **10**   | 4 selector, 6 discovery; all `dead-glob` |
| B: `tsconfig.build.json` (loads 186 files) | **6**    | 6 discovery, all `onDisk: absent`        |

**Verdict against the registered decision rule** — _does any finding's message assert a cause that
is wrong for that input?_ **Yes, twice, and both are now filed.**

1. **[Bug 0031](../bugs/0031-diagnose-blames-the-glob-when-the-project-loaded-nothing.md)** —
   hono's root tsconfig is `"files": []` plus project references, so it loads nothing (confirmed
   independently: `tsc --listFilesOnly` also lists 0). `check` says so correctly; `doctor`, in the
   same run, blames each glob in turn. `slice-rule-builder.ts:345` already states the rule —
   _"blaming the glob would send the caller to the wrong file entirely"_ — and `diagnose()` does
   not apply it. The 4 selector findings in that same run got the **right** cause, which is what
   makes it a defect rather than a limit.
2. **[Bug 0032](../bugs/0032-an-absent-path-defers-to-a-cause-list-it-refutes.md)** — `onDisk:
'absent'` maps to `''`, so it falls through to `no-match`'s three causes, two of which are
   refuted by what `absent` means. `ON_DISK_ADVICE`'s own docstring states that principle and
   applies it to the other two known-fact cases.

**So the gate opens and R3b is startable — after those two.** Not as a nicety: R3b's whole content
is turning this diagnostic into a **failure**, so these strings stop being advice a human skims
and become the text CI prints and an agent acts on. Shipping the flip first would take a message
that is wrong on a real adopting codebase's first run and make it a red build. That is ADR-008
rule 2 — a remedy must be verified to remediate — asked of R3b's own output.

**Two side observations, not blocking, recorded because they came out of the same run:**

- `ts-archunit --shape layered` (a plausible wrong guess; the flag is `--preset`) exits with a raw
  Node `ERR_PARSE_ARGS_UNKNOWN_OPTION` stack trace rather than a message naming the valid flags.
- The `layered` scaffold emits `shared: ['**/src/shared/**']`, but `shared` is read only under
  `strict: true`, which the scaffold does not set. The option is inert as scaffolded, and nothing
  says so — the glob is not diagnosed either, correctly, since it is never used.

## The other two decisions, both 0069's, both still open

1. **`doctor`: keep as a supported command, or retire it?** 0069 requires this be decided
   **before** R3, and says why it cannot drift: _"shipping it experimental/hidden is precisely
   the mechanism that defers the decision."_ It currently ships experimental/hidden.
   **SETTLED by [plan 0077](./completed/0077-doctor-promote-it.md), shipped in v0.32.0**: promoted,
   listed in `--help`, scope stated. What earns it the slot is a **dead selector glob** — `check`
   never calls `diagnose()`, so it exits 0 with no output where `doctor` exits 1 and names the
   site. 0077 also asserted that only `doctor` catches load failures; that was false and review
   caught it — `check` catches those too, exits 1, and prints a remedy. The "loadable
   `arch.rules.ts`" constraint is real for `doctor` and **not** for the diagnosis, so the gate can
   be run either way, which is what gate run 4 above did on both sides.
2. **Version sequencing.** R3b is breaking. 0069's open question 1: _"1.0 is at minimum
   R3 → path-norm → two quiet releases."_

## What is already built and must not be rebuilt

- `GlobNode` / `GlobSite` / `globSitesOf`, exported — R2a.
- `PathUniverse` and `viewsFor` — R2a. `import-target` deliberately has no views (bug 0014).
- `glob-diagnosis`, including the `no-match` cause list and the `outside-project` /
  `no-typescript` enrichment — R2a.
- The 50,000-entry walk budget with its documented degrade — 0069, prompted by gate run 2's
  Rust crate.
- `doctor`, reporting glob faults **and** condition-less rules — R2a.
- The severity floor and the `.warn()` throw — R3a, v0.20.0. Its unbuilt half was
  [bug 0029](../bugs/fixed/0029-a-throwing-warn-truncates-the-rest-of-the-rule-file.md), now fixed.

## Out of scope

- **Condition globs.** Declared as of
  [plan 0073](./completed/0073-conditions-declare-their-globs.md) (12 conditions, stamped
  `position: 'condition'`), so R3b now sees them — and the two `condition` rows above still say
  "no fault", which is why 0073 changed no verdict and R3b must not start changing them either.
- **Path normalization** — making `'src/*'` _work_ rather than merely diagnosing it. 0069
  keeps this separable, and it is the second breaking change on the 1.0 path.
- **Bug 0015**, the `only*` edgeless-subject exposure.
