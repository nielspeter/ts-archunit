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
let workDir: string

/** A rule file importing the live source, so it exercises the real builders. */
function writeRuleFile(name: string, body: string): string {
  const file = path.join(workDir, name)
  fs.writeFileSync(
    file,
    `import { project, modules } from '${repoRoot}/src/index.js'\n` +
      `const p = project('${repoRoot}/tsconfig.json')\n` +
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
      `  modules(p).that().resideInFolder('**/src/reslvers/**').should().notHaveDefaultExport().rule({ id: 'x/typo' }),`,
    )
    const code = await runDoctor({ ruleFiles: [file], format: 'json' })
    expect(code).toBe(1)
  })

  it('exits zero on a rule file with nothing wrong', async () => {
    const file = writeRuleFile(
      'clean.rules.ts',
      `  modules(p).that().resideInFolder('**/src/core/**').should().notHaveDefaultExport().rule({ id: 'x/ok' }),`,
    )
    const code = await runDoctor({ ruleFiles: [file], format: 'json' })
    expect(code).toBe(0)
  })

  it('reports identities, never a total', async () => {
    // A count is the snapshot ADR-008 rule 4 bars, and it is the number people
    // ratchet against instead of fixing the findings.
    const file = writeRuleFile(
      'two.rules.ts',
      `  modules(p).that().resideInFolder('**/src/nope-a/**').should().notHaveDefaultExport().rule({ id: 'x/a' }),\n` +
        `  modules(p).that().resideInFolder('**/src/nope-b/**').should().notHaveDefaultExport().rule({ id: 'x/b' }),`,
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
    expect(text).toContain('**/src/nope-a/**')
    // Structural, not a guess at one phrasing. The previous form was
    // `/\b2 (findings|problems|issues)\b/`, and appending the most natural
    // spelling of the banned thing — "Total: 2 rules cannot enforce
    // anything." — slipped straight through it.
    expect(text).not.toMatch(/\d+\s+\w*\s*(finding|rule|glob|problem|issue)/i)
    expect(text).not.toMatch(/\btotal\b/i)
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
