/**
 * `.warn()` output has to reach the developer (bug 0024).
 *
 * **A spy cannot test this, which is why the bug shipped.** Every existing test
 * of the warn path asserted that the channel was *called* — `vi.spyOn(console,
 * 'warn')` — and a spy proves the call, never the delivery. vitest's default
 * reporter intercepts console output and replays it only for **failing** tests,
 * and `.warn()` never fails a test, so 4 real violations produced zero output
 * for every version through v0.24.x.
 *
 * So this spawns a real `vitest run` over a real fixture, in a child process,
 * with the default reporter and `CI=true`, and reads what a developer would
 * actually see. It is slow by the standards of this suite and it is the only
 * shape that can fail for the right reason.
 *
 * The bug asks for sabotage in both directions, and both are here: the passing
 * test must show the output (that is the fix), and the failing-test case must
 * still show it (otherwise this is measuring the failure path, where vitest
 * replays intercepted output anyway, and would pass even with the defect
 * restored).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { project } from '../../src/core/project.js'

const repoRoot = path.resolve(import.meta.dirname, '../..')

/**
 * Generated INSIDE the tests tree, not in a temp directory.
 *
 * `vitest.config.ts` sets `include: ['tests/**\/*.test.ts']`, so a probe written
 * to `os.tmpdir()` is filtered out and the child exits 1 with "No test files
 * found" — which reads exactly like the assertion failing. Measured. Living here
 * also means the probe imports the library through the same relative paths every
 * other test uses, instead of hand-built absolute paths into `node_modules`.
 *
 * The parent run globbed its file list before `beforeAll` created anything here,
 * so these are never collected by the run that writes them.
 *
 * **`tests/__generated__` is excluded from `tsconfig.json` and gitignored, and both
 * are load-bearing.** `include: ["src", "tests"]` made these files members of the
 * ROOT ts-morph program, so a concurrent `new Project({ tsConfigFilePath })` that
 * was mid-load when `afterAll` deleted the directory threw
 * `Error: File not found: …/tests/__generated__/failing.test.ts` — six test files
 * build a project from the root tsconfig and were all exposed. Measured at roughly
 * three runs in four whenever two suites overlapped, which is what a developer with
 * `vitest --watch` open alongside `npm test` does. CI runs one suite, so CI never
 * saw it.
 *
 * A crashed run also left untracked `.test.ts` files that the next `npm run
 * typecheck` compiled — and `prepublishOnly` runs `validate`, so that state blocks
 * a publish with an error pointing at a file nobody wrote.
 *
 * Pinned below by `the generated directory is invisible to the root project`.
 */
/**
 * Per-process, and that is load-bearing —
 * [bug 0045](../../bugs/fixed/0045-two-tests-fail-by-environment-and-corrupt-sabotage-verdicts.md).
 *
 * This used to be `tests/__generated__` flat, with `beforeAll` deleting the whole
 * directory. One checkout running two suites at once — two agents, or a watch
 * run beside a manual one — meant each process's setup destroyed the other's
 * files mid-flight, surfacing as `ENOENT … channel.mjs` from a line that had
 * just written it. Observed once in ten full runs, and the reason matters more
 * than the rate: a sabotage matrix reads exit codes, so a spurious failure scores
 * the row CAUGHT, which is the reassuring direction.
 *
 * `tests/__generated__/` is gitignored and tsconfig-excluded by directory
 * prefix, so a nested per-process directory is still invisible to both.
 */
const generatedRoot = path.join(repoRoot, 'tests/__generated__')
const generatedDir = path.join(generatedRoot, `run-${String(process.pid)}`)

/** A test file that uses the library exactly as a consumer's test would. */
function writeProbe(name: string, body: string): string {
  const file = path.join(generatedDir, name)
  fs.writeFileSync(
    file,
    [
      `import { describe, it, expect } from 'vitest'`,
      `import { Project } from 'ts-morph'`,
      // ABSOLUTE imports and paths, not `../../`. The probe now lives one level
      // deeper (a per-process directory, bug 0045), and a relative depth encoded
      // in a generated file breaks silently the moment that layout changes —
      // the child run simply finds no tests, which reads as a library failure.
      // Deriving both from `repoRoot` at write time makes the probe indifferent
      // to where it is written.
      `import { functions } from ${JSON.stringify(path.join(repoRoot, 'src/builders/function-rule-builder.js'))}`,
      ``,
      `const tsconfig = ${JSON.stringify(path.join(repoRoot, 'tests/fixtures/poc/tsconfig.json'))}`,
      `const p = new Project({ tsConfigFilePath: tsconfig })`,
      `const proj = { tsConfigPath: tsconfig, _project: p, getSourceFiles: () => p.getSourceFiles() }`,
      `const parsers = () => functions(proj).that().haveNameMatching(/^parse/).should().notExist()`,
      ``,
      body,
    ].join('\n'),
  )
  return file
}

/**
 * Run vitest as a child, with the DEFAULT reporter — the one a consumer runs and
 * the one that drops intercepted console output from passing tests.
 */
function runVitest(file: string): { output: string; status: number } {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'node_modules/vitest/vitest.mjs'), 'run', file, '--root', repoRoot],
    {
      cwd: repoRoot,
      encoding: 'utf-8',
      env: { ...process.env, CI: 'true', NO_COLOR: '1' },
      timeout: 120_000,
    },
  )
  return { output: `${result.stdout ?? ''}${result.stderr ?? ''}`, status: result.status ?? -1 }
}

beforeAll(() => {
  // Cleaned on the way IN as well as out: a crashed earlier run would otherwise
  // leave probe files that the next parent run collects as its own tests.
  //
  // **That intent needed the loop below to be true.** Removing only
  // `generatedDir` handles a re-run at the same pid and nothing else — a fresh
  // process has a different pid, so a killed run's `run-<oldpid>/` survived
  // forever. It is gitignored, so `git status` reads clean; `include:
  // ['tests/**/*.test.ts']` collects it; and the probe files are *designed* to
  // fail. A reviewer hit exactly that: an isolated worktree whose very first
  // baseline read exit 1 for a reason nothing in the working tree showed. That is
  // the ADR-008 rule 5 verdict-mechanism hazard — a sabotage matrix reading exit
  // codes cannot tell that failure from a real one.
  //
  // Pruned by LIVENESS, not by age or by wildcard: `process.kill(pid, 0)` throws
  // for a pid that no longer exists and does nothing to one that does, so a
  // concurrent sibling's directory is never touched. Deleting another run's files
  // is bug 0045 and is not being reintroduced here.
  for (const entry of fs.existsSync(generatedRoot) ? fs.readdirSync(generatedRoot) : []) {
    const pid = Number(/^run-(\d+)$/.exec(entry)?.[1])
    if (!Number.isInteger(pid) || pid === process.pid) continue
    try {
      process.kill(pid, 0)
      continue // alive: a sibling run owns it
    } catch {
      fs.rmSync(path.join(generatedRoot, entry), { recursive: true, force: true })
    }
  }
  fs.rmSync(generatedDir, { recursive: true, force: true })
  fs.mkdirSync(generatedDir, { recursive: true })
})
afterAll(() => {
  fs.rmSync(generatedDir, { recursive: true, force: true })
  // Tidy the shared parent, but only when this was the last run using it —
  // `rmdir` fails harmlessly if a sibling process still has a directory there,
  // which is exactly the check we want and why it is not `rmSync`.
  try {
    fs.rmdirSync(generatedRoot)
  } catch {
    // A sibling run still owns a subdirectory. Leave it.
  }
})

describe('the generated directory is invisible to the root project', () => {
  it('a file written here is not a member of the root ts-morph program', () => {
    // The guard for the flakiness this file caused. Behavioural, not a re-read of
    // the tsconfig I edited: write a real file, load the root project the way six
    // other test files do, and assert ts-morph never sees it. If `exclude` loses
    // this entry, a concurrent suite starts throwing `File not found` when
    // `afterAll` runs — and the failure surfaces in unrelated files, which is what
    // made it hard to attribute.
    const planted = path.join(generatedDir, 'planted.ts')
    fs.writeFileSync(planted, 'export const planted = 1\n')
    const root = project(path.join(repoRoot, 'tsconfig.json'))
    const seen = root.getSourceFiles().map((sf) => sf.getFilePath())
    // Vacuity anchor: the project really loaded this repo.
    expect(seen.length).toBeGreaterThan(400)
    expect(seen.filter((f) => f.includes('__generated__'))).toEqual([])
    fs.rmSync(planted, { force: true })
  })
})

describe('.warn() inside a test that PASSES', () => {
  it('prints its violations where the developer can see them', () => {
    const file = writeProbe(
      'passing.test.ts',
      [
        `describe('advisory', () => {`,
        `  it('warns and passes', () => {`,
        `    const rule = parsers()`,
        `    expect(rule.violations()).toHaveLength(4)`,
        `    rule.warn()`,
        `  })`,
        `})`,
      ].join('\n'),
    )
    const { output, status } = runVitest(file)

    // The test really passed — otherwise this is the failing-test path, where
    // vitest replays intercepted output and the defect is invisible.
    expect(status, output).toBe(0)
    expect(output).toContain('1 passed')

    // And the violations reached the reader. `parseFooOrder` is a real function
    // in the poc fixture; the count is asserted inside the child, so this
    // cannot pass on an empty rule.
    expect(output).toContain('parseFooOrder')
    expect(output).toContain('should not exist')
  })
})

describe('the same output when the test FAILS', () => {
  it('still reaches the reader', () => {
    // The other direction the bug asks for. With the defect restored this test
    // would pass — vitest replays intercepted console output for failing tests —
    // so it exists to stop someone "simplifying" the passing case above into
    // this one and concluding the channel works.
    const file = writeProbe(
      'failing.test.ts',
      [
        `describe('advisory', () => {`,
        `  it('warns, then fails for an unrelated reason', () => {`,
        `    parsers().warn()`,
        `    expect(1).toBe(2)`,
        `  })`,
        `})`,
      ].join('\n'),
    )
    const { output, status } = runVitest(file)
    expect(status).not.toBe(0)
    expect(output).toContain('parseFooOrder')
  })
})

describe('the other library warnings, on the same channel', () => {
  it('a stale exclusion is reported from a passing test', () => {
    // `.warn()` was the reported half; the same silence covered every
    // library-originated message. A stale `.excluding()` in a passing test said
    // nothing at all, so the one signal that an exclusion has rotted after a
    // rename was unreachable in the runner where rules are written.
    const file = writeProbe(
      'stale-exclusion.test.ts',
      [
        `describe('stale exclusion', () => {`,
        `  it('reports it and passes', () => {`,
        `    const v = parsers().rule({ id: 'probe/stale' }).excluding('NoSuchElement').violations()`,
        `    expect(v).toHaveLength(4)`,
        `  })`,
        `})`,
      ].join('\n'),
    )
    const { output, status } = runVitest(file)
    expect(status, output).toBe(0)
    expect(output).toContain('1 passed')
    expect(output).toContain('Unused exclusion')
    expect(output).toContain('NoSuchElement')
  })
})

describe('the generated directory is this process’s alone (bug 0045)', () => {
  // A STRUCTURAL pin, and labelled as one rather than dressed up as a guard.
  //
  // The defect needs two processes sharing a checkout, and a suite run is one
  // process — measured: reverting to the shared directory leaves the rest of the
  // suite green. So it cannot be guarded behaviourally from inside the suite.
  // What this CAN do is stop the property being removed casually.
  //
  // The behavioural proof was taken by hand and is recorded on the bug: with the
  // old code, deleting the shared root mid-run — exactly what a sibling's
  // `beforeAll` did — killed the run with the same `ENOENT` the flake reported;
  // with the new code, deleting a sibling's directory changes nothing.
  it('the path is unique per process, so two runs cannot collide', () => {
    expect(generatedDir).toContain(String(process.pid))
    expect(generatedDir.startsWith(generatedRoot)).toBe(true)
    expect(generatedDir).not.toBe(generatedRoot)
  })

  it('cleanup never removes a sibling’s directory', () => {
    // The other half: owning a subdirectory is worthless if teardown still
    // deletes the parent recursively. `rmdirSync` on the root is deliberate —
    // it fails while a sibling still has one, which is the check we want.
    const sibling = path.join(generatedRoot, 'run-000000')
    fs.mkdirSync(sibling, { recursive: true })
    try {
      expect(() => {
        fs.rmdirSync(generatedRoot)
      }).toThrow()
      expect(fs.existsSync(sibling)).toBe(true)
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true })
    }
  })
})

describe('the channel itself', () => {
  // Two properties of `writeStderr` that the child-process tests above cannot
  // see, both measured in their own child because they are about process
  // behaviour rather than about text.
  const runNode = (script: string, pipe: boolean): { status: number; out: string } => {
    const file = path.join(generatedDir, 'channel.mjs')
    fs.writeFileSync(file, script)
    // `sh -c` so the pipe is real: a closed downstream reader is the whole point,
    // and spawnSync's own stdio cannot reproduce it.
    const cmd = pipe
      ? `${JSON.stringify(process.execPath)} ${JSON.stringify(file)} 2>&1 | head -2 >/dev/null; exit \${PIPESTATUS[0]}`
      : `${JSON.stringify(process.execPath)} ${JSON.stringify(file)} 2>&1`
    const r = spawnSync('bash', ['-c', cmd], { encoding: 'utf-8', timeout: 60_000 })
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  }

  it('survives a closed downstream pipe instead of dying of EPIPE', () => {
    // Node's Console is built with `ignoreErrors: true`; a bare
    // `process.stderr.write` is not, and the EPIPE arrives ASYNCHRONOUSLY, so
    // neither try/catch nor the write callback can see it. Measured over 20 000
    // lines: bare write exits 1, an attached 'error' listener exits 0.
    //
    // This is not hypothetical for this library: `writeReport` already wrote to
    // stderr unguarded, so `ts-archunit check 2>&1 | head` could fail for EPIPE
    // rather than for findings — indistinguishable from the exit code.
    const { status } = runNode(
      [
        `import { writeStderr } from ${JSON.stringify(path.join(repoRoot, 'src/core/stderr.ts'))}`,
        `const line = 'x'.repeat(200)`,
        `for (let i = 0; i < 20000; i++) writeStderr(line)`,
      ].join('\n'),
      true,
    )
    expect(status).toBe(0)
  })

  it('TRIPWIRE: nothing writes to stderr except the channel', () => {
    // Paired with the behavioural test above, and honest about being a tripwire.
    //
    // The behavioural half proves the CHANNEL is EPIPE-safe. It cannot prove
    // nobody bypasses it: reverting `writeReport` to its own bare
    // `process.stderr.write` was caught by nothing, and the obvious behavioural
    // guard is unavailable — bare node cannot import these modules (they use
    // `.js` specifiers that resolve to `.ts`, which only the bundler does), and
    // running the probe under vitest hands stdio to vitest, so the closed pipe
    // stops being real. Both measured before settling for a source scan.
    //
    // `console.error` in `src/cli/` is deliberately exempt: `Console` is built
    // with `ignoreErrors: true`, so it is EPIPE-safe by construction, and a
    // terminal command is not running inside a test runner.
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else if (entry.name.endsWith('.ts')) {
          const rel = path.relative(repoRoot, full)
          if (rel === path.join('src', 'core', 'stderr.ts')) continue
          const text = fs.readFileSync(full, 'utf-8')
          // Comments discussing the API are fine; a call is not.
          for (const [i, line] of text.split('\n').entries()) {
            const code = line.replace(/\/\/.*$/, '')
            if (code.includes('process.stderr.write(')) offenders.push(`${rel}:${i + 1}`)
          }
        }
      }
    }
    walk(path.join(repoRoot, 'src'))
    expect(offenders).toEqual([])
  })

  it('separates consecutive messages, as console.warn did', () => {
    // The call sites this replaced used `console.warn`, which appends a newline.
    // Ten sites remembering to add one is a mistake waiting to happen, and two
    // findings run onto one line is the defect this channel exists to avoid.
    const { out } = runNode(
      [
        `import { writeStderr } from ${JSON.stringify(path.join(repoRoot, 'src/core/stderr.ts'))}`,
        `writeStderr('FIRST-MESSAGE')`,
        `writeStderr('SECOND-MESSAGE')`,
        `writeStderr('THIRD-ALREADY-ENDS\\n')`,
      ].join('\n'),
      false,
    )
    expect(out).toContain('FIRST-MESSAGE\nSECOND-MESSAGE\n')
    // An already-terminated message must not gain a second newline.
    expect(out).toContain('THIRD-ALREADY-ENDS\n')
    expect(out).not.toContain('THIRD-ALREADY-ENDS\n\n')
  })
})
