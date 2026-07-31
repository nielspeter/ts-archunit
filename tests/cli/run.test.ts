import fs, { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { run } from '../../src/cli/index.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pkgPath = path.join(repoRoot, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string }

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('run', () => {
  it('prints help with --help flag', async () => {
    const chunks: string[] = []
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })
    await run(['--help'])
    const output = chunks.join('')
    expect(output).toContain('ts-archunit')
    expect(output).toContain('Usage')
    writeSpy.mockRestore()
  })

  it('prints version with --version flag', async () => {
    const chunks: string[] = []
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })
    await run(['--version'])
    const output = chunks.join('')
    expect(output).toContain(pkg.version)
    writeSpy.mockRestore()
  })

  it('sets exitCode=1 for unknown command', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(['unknown-command'])
    expect(process.exitCode).toBe(1)
  })

  it('sets exitCode=1 when no command given', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run([])
    expect(process.exitCode).toBe(1)
  })

  it('sets exitCode=1 when check has no rule files', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(['check'])
    expect(process.exitCode).toBe(1)
  })

  it('sets exitCode=1 when baseline has no rule files', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(['baseline'])
    expect(process.exitCode).toBe(1)
  })

  it('lists the init subcommand and its flags in --help', async () => {
    const chunks: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk))
      return true
    })
    await run(['--help'])
    const output = chunks.join('')
    expect(output).toContain('ts-archunit init')
    expect(output).toContain('--preset')
  })

  it('sets exitCode=1 when init gets an invalid --preset', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(['init', '--preset', 'nope', '--tsconfig', 'definitely-missing.json'])
    expect(process.exitCode).toBe(1)
  })

  it('rejects a --format value not valid for check (e.g. agent)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(['check', 'rules.ts', '--format', 'agent'])
    expect(process.exitCode).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("not valid for 'check'"))
  })

  it('rejects a --format value not valid for explain (e.g. github)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await run(['explain', 'rules.ts', '--format', 'github'])
    expect(process.exitCode).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("not valid for 'explain'"))
  })
})

describe('baseline propagates its exit code', () => {
  it("run(['baseline', ...]) sets exitCode from runBaseline", async () => {
    // The dispatcher half of the non-zero-on-refused change. `runBaseline`'s own
    // return value is asserted in the integration suite; unwiring it HERE — so
    // the command reports the blocker and the process still exits 0 — was caught
    // by nothing, which is the whole failure mode: an agent reads exit 0 as
    // "nothing to do", commits the baseline, and the next job reds.
    //
    // Driven through a real rule file rather than a mock, because the wiring is
    // what is under test and a mocked loader would bypass the dispatcher.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsau-run-baseline-'))
    const rules = path.join(dir, 'arch.rules.ts')
    const out = path.join(dir, 'baseline.json')
    fs.writeFileSync(
      rules,
      [
        "import { project, functions } from '" + repoRoot + "/src/index.js'",
        "const p = project('" + repoRoot + "/tests/fixtures/poc/tsconfig.json')",
        // No condition: an assertion-less rule, so its finding cannot be baselined.
        'export default [functions(p).that().haveNameMatching(/^parse/).should()]',
      ].join('\n'),
    )
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    try {
      await run(['baseline', rules, '--output', out])
    } finally {
      writeSpy.mockRestore()
      fs.rmSync(dir, { recursive: true, force: true })
    }
    expect(process.exitCode).toBe(1)
  })
})

describe('doctor (supported since plan 0077)', () => {
  it('reaches runDoctor rather than the unknown-command arm', async () => {
    // `exitCode` is 1 either way — the unknown-command arm also sets it — so
    // asserting the code is another false green. The MESSAGE is what
    // distinguishes "dispatched" from "not a command", and renaming the
    // dispatch arm left the whole suite green before this test existed.
    const written: string[] = []
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      written.push(args.map(String).join(' '))
    })
    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))
      return true
    })
    try {
      await run(['doctor'])
    } finally {
      writeSpy.mockRestore()
      errorSpy.mockRestore()
    }
    const output = written.join('')
    expect(output).not.toContain('Unknown command')
    expect(output).toContain('no rule files')
  })

  it('rejects a --format it does not support', async () => {
    // Unvalidated while the command was hidden: `--format github` ran silently
    // as terminal. Tolerable for something absent from `--help`, not for a
    // listed command whose flag surface a reader now expects to be real.
    const errors: string[] = []
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.map(String).join(' '))
    })
    try {
      await run(['doctor', '--format', 'github', 'x.ts'])
    } finally {
      errSpy.mockRestore()
    }
    expect(errors.join('')).toContain("--format 'github' is not valid for 'doctor'")
    expect(errors.join('')).toContain('terminal, json')
  })

  it('is listed in --help, because it is supported', async () => {
    /**
     * Inverted by plan 0077, which settled the keep-or-retire question 0069 left
     * open. It was hidden while the decision was pending — and 0069 named that
     * exact state as the mechanism that defers a decision, which it then did for
     * five sessions.
     *
     * The investigation reversed its own first recommendation. Retiring it looked
     * right until two things were measured: `getting-started.md` calls the CLI
     * "the default path" and `init` scaffolds a rule file with zero vitest
     * imports, so `doctor` serves the documented default; and it reports a rule
     * file that FAILS TO LOAD, which `diagnose()` cannot, because it never loads
     * one. A rule file that does not load is zero coverage reported as success.
     */
    const written: string[] = []
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))
      return true
    })
    try {
      await run(['--help'])
    } finally {
      writeSpy.mockRestore()
    }
    const help = written.join('')
    expect(help).toContain('ts-archunit doctor')
    // Named alongside its siblings, not tucked in an options line — the point of
    // promotion is that a reader scanning the command list finds it.
    expect(help).toContain('Report rules that cannot enforce anything')
  })
})
