/**
 * The `doctor` CLI command (plan 0069 R2a).
 *
 * Experimental and hidden: it is deliberately absent from `--help`, because
 * removing a documented command later is its own breaking change and its life
 * after R3 is undecided. Shipping it hidden is what defers that decision.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { runDoctor } from '../../src/cli/commands/doctor.js'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const FIXTURE_TSCONFIG = path.join(repoRoot, 'tests/fixtures/modules/tsconfig.json')
const REPO_TSCONFIG = path.join(repoRoot, 'tsconfig.json')
let workDir: string

/**
 * A rule file importing the live source, so it exercises the real builders.
 *
 * `tsconfig` defaults to a small FIXTURE project. Pointing every case at the
 * repository's own tsconfig loaded 430+ files through ts-morph inside a worker
 * competing with 165 other test files: the first case took 1585ms against a
 * 5000ms default timeout and flaked under load. A flake in a suite whose whole
 * method is sabotage is worse than an ordinary one — it produces a red for the
 * wrong reason, and next time it will produce a red that hides a real green.
 */
function writeRuleFile(name: string, body: string, tsconfig = FIXTURE_TSCONFIG): string {
  const file = path.join(workDir, name)
  fs.writeFileSync(
    file,
    `import { project, modules } from ${JSON.stringify(repoRoot + '/src/index.js')}\n` +
      `const p = project(${JSON.stringify(tsconfig)})\n` +
      `export default [\n${body}\n]\n`,
  )
  return file
}

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archunit-doctor-'))
})
afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

describe('runDoctor', () => {
  it('exits non-zero when it reports anything', async () => {
    // Not a build gate — but an agent reads `exit 0` as "nothing to do"
    // (ADR-008 rule 1), so a diagnostic that reports problems and exits 0 is
    // one nobody acts on.
    const file = writeRuleFile(
      'dead.rules.ts',
      `  modules(p).that().resideInFolder('**/reslvers/**').should().notHaveDefaultExport().rule({ id: 'x/typo' }),`,
    )
    expect(await runDoctor({ ruleFiles: [file], format: 'json' })).toBe(1)
    // BOTH exit paths, because they are separate `return` statements and only
    // the json one was covered.
    expect(await runDoctor({ ruleFiles: [file], format: 'terminal' })).toBe(1)
  })

  it('exits non-zero when a rule file throws at import', async () => {
    // `loadRuleFiles` returns nothing when the import throws, so tolerating the
    // error without this check turned a visible crash into exit 0 plus a clean
    // bill of health.
    const file = path.join(workDir, 'selfexec.rules.ts')
    fs.writeFileSync(
      file,
      `import { project, modules } from ${JSON.stringify(repoRoot + '/src/index.js')}\n` +
        `const p = project(${JSON.stringify(FIXTURE_TSCONFIG)})\n` +
        `modules(p).that().resideInFolder('**/domain/**').should().notExist().check()\n` +
        `export default []\n`,
    )
    expect(await runDoctor({ ruleFiles: [file], format: 'json' })).toBe(1)
  })

  it('exits non-zero on a rule file that exports no rules', async () => {
    // The earlier guard checked `args.ruleFiles.length`, which is the wrong
    // derivation: a file exporting `[]` reached the report and was called clean.
    const file = path.join(workDir, 'empty.rules.ts')
    fs.writeFileSync(file, 'export default []\n')
    expect(await runDoctor({ ruleFiles: [file], format: 'json' })).toBe(1)
  })

  it('exits zero on a rule file with nothing wrong', async () => {
    const file = writeRuleFile(
      'clean.rules.ts',
      `  modules(p).that().resideInFolder('**/domain/**').should().notHaveDefaultExport().rule({ id: 'x/ok' }),`,
    )
    const code = await runDoctor({ ruleFiles: [file], format: 'json' })
    expect(code).toBe(0)
  })

  it('reports identities, never a total', async () => {
    // A count is the snapshot ADR-008 rule 4 bars, and it is the number people
    // ratchet against instead of fixing the findings.
    const file = writeRuleFile(
      'two.rules.ts',
      `  modules(p).that().resideInFolder('**/nope-a/**').should().notHaveDefaultExport().rule({ id: 'x/a' }),\n` +
        `  modules(p).that().resideInFolder('**/nope-b/**').should().notHaveDefaultExport().rule({ id: 'x/b' }),`,
    )
    const out: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      out.push(String(chunk))
      return true
    }
    try {
      await runDoctor({ ruleFiles: [file], format: 'terminal' })
    } finally {
      process.stderr.write = original
    }
    const text = out.join('')
    expect(text).toContain('x/a')
    expect(text).toContain('x/b')
    expect(text).toContain('**/nope-a/**')
    // Structural, so no phrasing can slip through. Two guesses at a wording
    // already have: `/\b2 (findings|problems|issues)\b/` missed "Total: 2
    // rules...", and the wider noun list missed "Summary: 2 items need
    // attention." Every non-blank line belongs to a finding — three per
    // finding, nothing else — so a total has nowhere to live. Derived from the
    // rule file this test wrote, not pinned.
    const lines = text.split('\n').filter((line) => line.trim() !== '')
    expect(lines).toHaveLength(2 * 3)
  })

  it('states what the filesystem knows, and asserts no remedy for it', async () => {
    // `examples/` holds real TypeScript and is excluded by this repo's
    // tsconfig — the majority case in a real monorepo. The message must say
    // that and stop: every candidate remedy is wrong on a reachable input,
    // which is what the gate run established when a TypeScript monorepo
    // turned out to contain a Rust crate.
    const file = writeRuleFile(
      'excluded.rules.ts',
      `  modules(p).that().resideInFolder('**/examples/**').should().notHaveDefaultExport().rule({ id: 'x/excluded' }),`,
      REPO_TSCONFIG,
    )
    const chunks: string[] = []
    const original = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      chunks.push(String(chunk))
      return true
    }
    try {
      await runDoctor({ ruleFiles: [file], format: 'json' })
    } finally {
      process.stdout.write = original
    }
    const parsed: unknown = JSON.parse(chunks.join(''))
    expect(JSON.stringify(parsed)).toContain('holds-typescript')
    expect(JSON.stringify(parsed)).toContain('keeps it out of the project')
    // No remedy asserted — no "add", no "include it".
    expect(JSON.stringify(parsed)).not.toContain('add it to your tsconfig')
  })
})

describe('files that cannot be loaded (plan 0070, 0.22.0)', () => {
  it('a non-ArchRuleError load failure is reported, not a crash', async () => {
    // Review measured a raw TypeError (a vitest test file) crashing the whole
    // command and abandoning every remaining file.
    const file = path.join(workDir, 'throws-typeerror.mjs')
    fs.writeFileSync(file, `throw new TypeError('vitest runner not available')\n`)
    const stderr: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      stderr.push(String(chunk))
      return true
    }
    let code: number
    try {
      code = await runDoctor({ ruleFiles: [file], format: 'terminal' })
    } finally {
      process.stderr.write = original
    }
    expect(code).toBe(1)
    expect(stderr.join('')).toContain('could not be loaded')
    // The error text IS the evidence the message defers to, so pin it.
    expect(stderr.join('')).toContain('vitest runner not available')
    // The remedy is conditional: this file does NOT import a test runner, so
    // the message may offer that case but must not assert it as the cause.
    expect(stderr.join('')).not.toContain('A file that imports a test runner (vitest/jest) cannot')
  })

  it('MIXED case: a load failure plus a clean file still exits non-zero', async () => {
    // The regression review measured: error on stderr, then "No rules that
    // cannot enforce anything.", exit 0 — a clean bill of health after
    // reporting that a whole file went undiagnosed.
    const broken = path.join(workDir, 'broken.rules.ts')
    fs.writeFileSync(broken, `throw new TypeError('boom')\n`)
    const clean = writeRuleFile(
      'clean-with-condition.rules.ts',
      `  modules(p).that().resideInFolder('**/domain/**').should().notHaveDefaultExport(),`,
    )
    const stderr: string[] = []
    const original = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string | Uint8Array): boolean => {
      stderr.push(String(chunk))
      return true
    }
    let code: number
    try {
      code = await runDoctor({ ruleFiles: [broken, clean], format: 'terminal' })
    } finally {
      process.stderr.write = original
    }
    expect(code).toBe(1)
    expect(stderr.join('')).not.toContain('No rules that cannot enforce anything.')
    // Only true in the MIXED state. Without this the test passes when the
    // "clean" file ALSO fails to load (rules.length === 0 takes a different
    // exit with a different message) — measured, and the same trap the .mjs
    // fixtures sprang once already.
    expect(stderr.join('')).toContain('not a clean bill of health')
  })

  it('JSON format with NO loadable file still emits a parseable document', async () => {
    // The early return for "everything failed to load" precedes the format
    // branch, so stdout used to be zero bytes and `JSON.parse('')` threw — on
    // the commonest single-file invocation, for the exact consumer the
    // exit-code fix was written for. Measured: removing the emission here is
    // caught by nothing else in the suite.
    const broken = path.join(workDir, 'only-broken.rules.ts')
    fs.writeFileSync(broken, `throw new TypeError('nothing loadable here')\n`)
    const stdout: string[] = []
    const original = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      stdout.push(String(chunk))
      return true
    }
    let code: number
    try {
      code = await runDoctor({ ruleFiles: [broken], format: 'json' })
    } finally {
      process.stdout.write = original
    }
    expect(code).toBe(1)
    expect(stdout.join('')).not.toBe('')
    const payload = JSON.parse(stdout.join('')) as Record<string, unknown>
    expect(payload.findings).toEqual([])
    const failures = payload.loadFailures
    expect(Array.isArray(failures)).toBe(true)
    expect(JSON.stringify(failures)).toContain(path.basename(broken))
    expect(JSON.stringify(failures)).toContain('nothing loadable here')
  })

  it('MIXED case, JSON format: exit non-zero and the payload records the failure', async () => {
    // The sabotage matrix found the text-path fix alone leaves the JSON path
    // reverting silently: a JSON consumer saw clean findings + exit 0 while
    // stderr (which JSON consumers do not read) carried the error.
    const broken = path.join(workDir, 'broken-json.rules.ts')
    fs.writeFileSync(broken, `throw new TypeError('boom')\n`)
    const clean = writeRuleFile(
      'clean-json.rules.ts',
      `  modules(p).that().resideInFolder('**/domain/**').should().notHaveDefaultExport(),`,
    )
    const stdout: string[] = []
    const original = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string | Uint8Array): boolean => {
      stdout.push(String(chunk))
      return true
    }
    let code: number
    try {
      code = await runDoctor({ ruleFiles: [broken, clean], format: 'json' })
    } finally {
      process.stdout.write = original
    }
    expect(code).toBe(1)
    const payload = JSON.parse(stdout.join('')) as Record<string, unknown>
    // Identities, never totals: the payload names WHICH file and why, so a JSON
    // consumer never has to scrape stderr prose it does not read.
    const failures = payload.loadFailures
    expect(Array.isArray(failures)).toBe(true)
    expect(JSON.stringify(failures)).toContain(path.basename(broken))
    expect(JSON.stringify(failures)).toContain('boom')
  })
})
