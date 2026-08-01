# Bug 0032: an `absent` path defers to a cause list it refutes

**Reported:** 2026-07-31
**Found in:** v0.32.0 (the shipped npm package), by [plan 0074](../../plans/completed/0074-r3b-the-selector-glob-flip.md)'s gate run 4
**Status:** **FIXED** 2026-07-31, released in **v0.33.0**. Verified against the same real codebase that
found it, remedy included — see below.
**Severity:** Medium today, High once R3b ships — same escalation as
[bug 0031](./0031-diagnose-blames-the-glob-when-the-project-loaded-nothing.md): R3b turns this
advice into the text of a failing build.

## Description

`ON_DISK_ADVICE` maps a filesystem fact to a statement of that fact. Three of its four entries
carry text; `absent` carries `''`, so the caller falls back to `FAULT_ADVICE['no-match']` —

> Common causes: the glob names a directory rather than the files inside it (append `"/**"`), a
> path segment is misspelled, or the directory holds no source files

— **two of whose three causes are refuted by what `absent` means.** `disk-set.ts` is explicit
that `absent` is a verified negative over _every_ file and directory, TypeScript or not, with
pruned directories routed to `not-determined` precisely so that `absent` means absent:

```ts
/** Every file, TypeScript or not — so `absent` means absent, not "not TypeScript". */
```

So when the fact is "nothing matching this glob exists on disk":

| offered cause                               | status for this input                    |
| ------------------------------------------- | ---------------------------------------- |
| the glob names a directory — append `"/**"` | **refuted** — there is no such directory |
| the directory holds no source files         | **refuted** — there is no directory      |
| a path segment is misspelled                | plausible, and buried as one of three    |

`ON_DISK_ADVICE`'s own docstring states the principle being broken:

> Stated as a fact and never as a remedy. … So this contributes the fact and its own two causes,
> **rather than deferring to `no-match`'s list — two of whose three causes are refuted by the fact
> printed one line above.**

That is this bug, described in advance, applied to `holds-typescript` and `no-typescript` and not
to `absent`.

`not-determined` returning `''` is **correct** and must stay: no fact is known there, so deferring
to the cause list is the honest move. The two empty strings look alike and are not.

## Reproduction

Measured against `honojs/hono` @ `51db313`, published `@nielspeter/ts-archunit@0.32.0`, the
unedited `init --preset layered` scaffold, with `project()` pointed at `tsconfig.build.json` so
the project loads its 186 source files (which isolates this from bug 0031):

```
$ ts-archunit doctor --format json arch.rules.ts
6 findings — all kind=dead-glob, position=discovery, onDisk=absent
globs: **/src/routes/**, **/src/services/**, **/src/repositories/**
advice: "these are anchored but matched no file. Common causes: …"
```

Hono has no `src/routes`, `src/services` or `src/repositories` — it has `adapter`, `client`,
`helper`, `jsx`, `middleware`, `preset`, `request`, `router`, `utils`, `validator`. The tool
computed `onDisk: 'absent'`, put it in the finding's own field, and then did not say it.

This is the ordinary first-run state of the documented default path: `init` scaffolds example
globs, the adopter runs the tool, and the advice they get for the example globs is two-thirds
refuted by a fact the tool already holds.

## Fix

Give `absent` its own text in `ON_DISK_ADVICE`, in the same shape as its two populated siblings:
the fact, then the causes the fact leaves standing.

> no file or directory matching this glob exists on disk — a path segment is misspelled, or this
> names a folder you have not created yet

The second cause is not filler. [Plan 0072](../../plans/0072-a-denylist-glob-that-cannot-match.md)
established that a pre-emptive ban on a folder that does not exist is **legitimate** and is taught
by `docs/modules.md:38`, so the advice must not tell the reader their glob is wrong.

## Guard

The failure mode is a fix that reads well and remediates nothing, so the guard must assert the
**text** against a fixture whose path is genuinely absent, plus two controls that pin the
boundaries: `not-determined` must still fall through to `no-match`'s list (it is the case where
deferring is right), and `holds-typescript` must be unchanged. Without those, replacing every
empty string with prose passes.

## Related

- [Bug 0031](./0031-diagnose-blames-the-glob-when-the-project-loaded-nothing.md) — the other half
  of the same gate run.
- [Plan 0072](../../plans/0072-a-denylist-glob-that-cannot-match.md) — why "misspelled" must not be
  the only cause offered.

## Fix as shipped

`ON_DISK_ADVICE['absent']` now carries the fact and the causes the fact leaves standing:

> nothing matching this exists on disk — a path segment is misspelled, or it names a folder you
> have not created yet (banning one pre-emptively is legitimate: the rule arms when the folder
> appears)

`not-determined` keeps its empty string, with a comment saying it is **not** the same case despite
looking identical: there the walk was pruned, so no fact is known and deferring is honest.

**Verified on the input that found it.** Hono's six findings now read with the fact stated, and
applying the remedy — pointing the three example globs at folders hono actually has — cleared all
six and `doctor` exited **0**.

## Sabotage matrix

Three reverts, enumerated from the diff, all caught:

| revert                                                          | caught |
| --------------------------------------------------------------- | ------ |
| `absent` back to `''`                                           | yes    |
| overreach — `not-determined` filled in as well                  | yes    |
| states the fact but keeps "the directory holds no source files" | yes    |

## The first fix was itself confidently wrong, twice — corrected after review

Shipping "the fact, then the causes it leaves standing" is easy to say and was got wrong on the
first attempt in two independent ways. Both were found by review and both were then **measured**.

**1. It asserted a universal the walk cannot support.** The text said _"nothing matching this
exists on disk"_. `absent` is not a fact about the disk; it is the result of a **bounded** walk
from `discoverIdentityRoot`, which prunes 14 directory names and swallows unreadable directories.
Measured false on two reachable inputs:

```
parens dir EXISTS on disk, classify = absent      # app/(marketing)/ — picomatch reads () as a group
sibling package EXISTS = true, classify = absent  # monorepo checkout with no .git, identity root = packages/api
```

The text is now scoped to what was searched: _"no file or directory matching this was found under
the project root (build and vendor directories are not searched…)"_. The metacharacter case gets
the cause `slice-rule-builder.ts` already states for `check`.

**2. It handed a selector an excuse for the exact false green this project exists to kill.** The
draft carried plan 0072's _"banning one pre-emptively is legitimate"_. But 0072's case is a
`notImportFrom` — a **condition** glob — and `diagnose()` drops `condition` and `exclusion`
positions before this string is reached (`diagnose.ts`), so it printed **only** for `selector` and
`discovery`. There, a glob matching nothing means the rule has no subjects: the false green 0069 is
named after and R3b will fail the build on. The message told the agent it was fine. Removed, and
guarded by a test named for it.

The lesson is not "check the wording". It is that a message asserting a **fact** must be checked
against how that fact is derived — `absent` came from a bounded walk — and against **which callers
can reach it** — the position filter. Neither is visible from the constant alone, which is also why
the guard had to move (below).

## The guard moved, because the first one could not fail

The original test asserted the advice constants and **reimplemented** the selection that assembles
the shipped string. Review measured two mutations of the real selection leaving all 2719 tests
green — one of which appended the refuted causes straight back onto what the user reads. A constant
is not the message. The assertions now go through `diagnose()`, and a `not-determined` case
exercises the deferral end to end rather than asserting `=== ''`.

**Final matrix: 11 of 11**, including both mutations review found green.
