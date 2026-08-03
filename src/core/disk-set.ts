import fs from 'node:fs'
import path from 'node:path'
import picomatch from 'picomatch'
import type { ArchProject } from './project.js'
import { discoverIdentityRoot } from './identity-root.js'

/**
 * Directories never worth walking.
 *
 * `node_modules` and `.git` dominate the cost. The build-output names are here
 * because a walk that reports `dist/` as "absent from the project" is noise,
 * not a finding. The list cannot be complete — a real TypeScript monorepo may
 * hold a Rust `target/`, a Python `.venv`, a `.gradle` — which is why the
 * entry budget below exists rather than a longer list.
 */
const PRUNE = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.turbo',
  '.venv',
  'vendor',
  'target',
  '.gradle',
  '.yarn',
  '.cache',
])

/**
 * How many directory entries the walk will read before giving up.
 *
 * An implementation constant, not part of the public contract and not
 * tunable. It exists because the walk is unbounded in principle: a
 * contributor who has run `cargo build` inside a TypeScript monorepo has tens
 * of thousands of entries under one directory, and a *failing* run that then
 * hangs inside a 5s vitest timeout is a worse experience than the false green
 * this whole mechanism exists to remove. Above the budget the classification
 * degrades to `not-determined`, which costs message quality and nothing else —
 * the enrichment is already fail-open.
 */
const ENTRY_BUDGET = 50_000

// `.d.ts` and its `.d.mts`/`.d.cts` siblings count. They ARE TypeScript for
// the question this set answers — "does this path contain TypeScript your
// tsconfig is keeping out" — and excluding them made a `types/` directory of
// pure declarations report "this path exists but contains no TypeScript",
// which is false.
const TS_FILE = /\.(m|c)?tsx?$/

/**
 * What the filesystem says about a glob that the compiler's file set does not.
 *
 * Only populated for `no-match` — the other faults are syntactic and the disk
 * has nothing to add. `not-determined` is the honest answer above the walk's
 * entry budget, or where the walk refused to look.
 *
 * Declared here rather than in `glob-diagnosis.ts` because this is the module
 * that produces it: the other way round made the two files import each other.
 * Both edges were `import type` and therefore erased at runtime — but our own
 * `arch/no-cycles` rule slices by directory, so it could not see a cycle
 * INSIDE `core/`, and a per-file slicing in a test found it immediately. A
 * cycle nothing can see is the shape this whole plan is about.
 */
export type OnDisk = 'holds-typescript' | 'no-typescript' | 'absent' | 'not-determined'

/**
 * What the filesystem knows that the compiler's file set does not.
 *
 * The second derivation ADR-008 rule 5 asks for: filesystem contents versus
 * compiler membership. It is what distinguishes "your glob is misspelled" from
 * "your glob is fine and your tsconfig scope excludes it" — the cheapest wrong
 * action an agent can take, and the majority case in a real monorepo.
 */
export interface DiskSet {
  /** Classify a glob by what exists on disk under the paths it matches. */
  classify(glob: string): OnDisk
}

const cache = new WeakMap<ArchProject, DiskSet>()

/**
 * The project's disk set, walked at most once and only when asked.
 *
 * Lazy on purpose. This is only ever reached from `diagnoseGlob`, which is
 * only ever reached from an already-firing fault, so a project with no faults
 * never touches the filesystem. An eager version would charge every `check()`
 * a recursive walk to answer a question no fault asked.
 */
export function diskSet(project: ArchProject): DiskSet {
  const cached = cache.get(project)
  if (cached) return cached
  const built = build(project, ENTRY_BUDGET)
  cache.set(project, built)
  return built
}

/**
 * The walk, with the budget injectable.
 *
 * Exported for tests only. The degrade path is the difference between "not
 * determined" and a *partial, wrong* classification — a false "contains no
 * TypeScript" in the one message whose whole defence is that it states only
 * facts — and with the budget a module constant it could only ever have been
 * reached by accident on a repository nobody has.
 */
export function buildDiskSet(project: ArchProject, budgetLimit = ENTRY_BUDGET): DiskSet {
  return build(project, budgetLimit)
}

function build(project: ArchProject, budgetLimit: number): DiskSet {
  // Guard on the INPUT, before deriving anything. `discoverIdentityRoot` calls
  // `path.resolve`, so every root it returns is absolute and checking the
  // output can never fail. Both halves matter, and this repo's own suite
  // supplies both: the relative `'in-memory'` double (whose dirname is '.',
  // which would walk the real CWD) and absolute paths that do not exist, where
  // `readdirSync` throws from inside a guard. Counted in prose as "eight
  // doubles, two relative" until the suite reached 114 of them — so the shapes
  // are named and the arithmetic is not. And `ArchProject` is a public type, so
  // this protects user-constructed projects, not only test doubles.
  if (!path.isAbsolute(project.tsConfigPath)) return UNDETERMINED
  const root = discoverIdentityRoot(path.dirname(project.tsConfigPath))
  if (!fs.existsSync(root)) return UNDETERMINED

  const files: string[] = []
  /** Every file, TypeScript or not — so `absent` means absent, not "not TypeScript". */
  const everyFile: string[] = []
  const dirs: string[] = []
  /**
   * Directories the walk refused to enter.
   *
   * A glob matching one of these cannot be classified: nothing under it was
   * seen. Reporting `absent` would say "this path does not exist" about
   * `**\/dist/**` or `**\/vendor/**` — all realistic rule scopes — and
   * `absent` carries no advice, so the caller then falls back to a cause list
   * beginning "a path segment is misspelled".
   */
  const pruned: string[] = []
  let budget = budgetLimit
  let exhausted = false

  const walk = (dir: string): void => {
    if (exhausted) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return // unreadable or gone: not a finding, just not walkable
    }
    budget -= entries.length
    if (budget < 0) {
      exhausted = true
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name).replaceAll('\\', '/')
      // Prune by NAME, before asking whether it is a directory.
      //
      // [Bug 0045](../../bugs/fixed/0045-two-tests-fail-by-environment-and-corrupt-sabotage-verdicts.md):
      // `Dirent.isDirectory()` is false for a symlink, so a symlinked
      // `node_modules` — what pnpm produces, and what `git worktree add`
      // leaves behind — fell through to the `else` branch and was recorded as
      // a **file**. It never entered `pruned`, so a glob under it classified
      // `absent` ("no such path") instead of `not-determined` ("this walk
      // cannot say"). Those carry different advice, and `absent` is the one
      // that asserts something false.
      //
      // Safe: pruning records the path and does not recurse, so no link is
      // followed and the loop argument below is untouched.
      if (PRUNE.has(entry.name)) {
        pruned.push(full)
        continue
      }
      // `Dirent.isDirectory()` is false for a symlink under `withFileTypes`,
      // so symlink loops are impossible by construction. Do not "fix" this
      // with `statSync`, which follows them.
      //
      // The cost, for symlinks we do NOT prune: a symlinked source directory —
      // pnpm and yarn workspaces create them — is recorded as a file, so a glob
      // naming it classifies `no-typescript`. Wrong, but wrong in the direction
      // that only weakens a message; following the link risks a walk that never
      // terminates.
      if (entry.isDirectory()) {
        dirs.push(full)
        walk(full)
      } else {
        everyFile.push(full)
        if (TS_FILE.test(entry.name)) files.push(full)
      }
    }
  }
  walk(root.replaceAll('\\', '/'))
  if (exhausted) return UNDETERMINED

  // Containment is TRANSITIVE, and that is load-bearing. Using each file's
  // immediate parent instead labels `docs/` "contains no TypeScript" while
  // `docs/.vitepress/config.ts` sits one level below it — a false statement in
  // the one message whose entire defence is that it states only facts.
  // Measured on this repo: 36 directories hold TypeScript transitively but not
  // directly.
  const holdsTypeScript = new Set<string>()
  for (const file of files) {
    let dir = path.dirname(file)
    while (dir.length >= root.length) {
      holdsTypeScript.add(dir)
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  // Directories AND every file, not just the TypeScript ones. Deriving
  // `absent` from the TypeScript-only set asserted "this path does not exist"
  // about any path holding a `.md`, a `.json`, or anything under a pruned
  // name — and `absent` carries no advice, so the caller fell back to
  // `no-match`'s list, whose first cause is "a path segment is misspelled".
  // Exactly the confidently-wrong cause ADR-008 rule 2 forbids.
  const everything = [...everyFile, ...dirs]
  const typeScript = new Set(files)
  return {
    classify(glob: string): OnDisk {
      const isMatch = picomatch(glob)
      // Never `everything.some(isMatch)` — picomatch reads the array index as
      // its second argument and returns a truthy object from index 1 onwards.
      const matched = everything.filter((candidate) => isMatch(candidate))
      if (matched.length === 0) {
        // Not seen is not the same as not there.
        return pruned.some((dir) => isMatch(dir) || glob.includes(dir.slice(root.length + 1)))
          ? 'not-determined'
          : 'absent'
      }
      // Per GLOB, not per path: one glob routinely matches paths in both
      // categories — `**/tests/**` matched 44 directories of mixed kind on the
      // monorepo this was gated against. Any matched path holding TypeScript
      // makes the tsconfig the story worth telling.
      return matched.some(
        (candidate) => holdsTypeScript.has(candidate) || typeScript.has(candidate),
      )
        ? 'holds-typescript'
        : 'no-typescript'
    },
  }
}

const UNDETERMINED: DiskSet = {
  classify: () => 'not-determined',
}
