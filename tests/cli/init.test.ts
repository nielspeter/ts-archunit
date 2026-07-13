import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Project, Node } from 'ts-morph'
import { runInit } from '../../src/cli/commands/init.js'
import type { ArchProject } from '../../src/core/project.js'
import { recommended } from '../../src/presets/recommended.js'
import { agentGuardrails } from '../../src/presets/agent-guardrails.js'

const tmpDirs: string[] = []

/** Create an isolated temp project dir with a tsconfig; optional package.json / source files. */
function makeProject(
  opts: {
    tsconfigInclude?: string[]
    packageJson?: string | null
    srcFiles?: Record<string, string>
  } = {},
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsau-init-'))
  tmpDirs.push(dir)
  const include = opts.tsconfigInclude ?? ['src']
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true }, include }, null, 2),
  )
  if (opts.packageJson !== null) {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      opts.packageJson ?? JSON.stringify({ name: 'x', version: '1.0.0' }, null, 2) + '\n',
    )
  }
  for (const [rel, content] of Object.entries(opts.srcFiles ?? {})) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return dir
}

function read(dir: string, name: string): string {
  return fs.readFileSync(path.join(dir, name), 'utf-8')
}

function captureStdout(): { text: () => string; restore: () => void } {
  const chunks: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    chunks.push(String(c))
    return true
  })
  return { text: () => chunks.join(''), restore: () => spy.mockRestore() }
}

afterEach(() => {
  vi.restoreAllMocks()
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('runInit', () => {
  it('generates the three files and exits 0', () => {
    const dir = makeProject()
    const out = captureStdout()
    const code = runInit({ cwd: dir })
    out.restore()
    expect(code).toBe(0)
    expect(fs.existsSync(path.join(dir, 'ts-archunit.config.ts'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'arch.rules.ts'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'arch-baseline.json'))).toBe(true)
  })

  it('default preset (recommended) imports project from root and the preset from /presets', () => {
    const dir = makeProject()
    const out = captureStdout()
    runInit({ cwd: dir })
    out.restore()
    const rules = read(dir, 'arch.rules.ts')
    expect(rules).toContain("import { project } from '@nielspeter/ts-archunit'")
    expect(rules).toContain("import { recommended } from '@nielspeter/ts-archunit/presets'")
    expect(rules).toContain('...recommended(p)')
  })

  it('--preset agent-guardrails leads with agentGuardrails from /presets', () => {
    const dir = makeProject()
    const out = captureStdout()
    runInit({ cwd: dir, preset: 'agent-guardrails' })
    out.restore()
    const rules = read(dir, 'arch.rules.ts')
    expect(rules).toContain("import { agentGuardrails } from '@nielspeter/ts-archunit/presets'")
    expect(rules).toContain('...agentGuardrails(p, {')
    expect(rules).toContain("src: 'src/**'")
  })

  it('rejects an invalid --preset (shape presets not supported in v1)', () => {
    const dir = makeProject()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const code = runInit({ cwd: dir, preset: 'layered' })
    expect(code).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('recommended, agent-guardrails'))
    expect(fs.existsSync(path.join(dir, 'arch.rules.ts'))).toBe(false)
  })

  it('config omits the dead project/watchDirs fields, keeps rules/baseline/format', () => {
    const dir = makeProject()
    const out = captureStdout()
    runInit({ cwd: dir })
    out.restore()
    const config = read(dir, 'ts-archunit.config.ts')
    expect(config).toContain("rules: ['arch.rules.ts']")
    expect(config).toContain("baseline: 'arch-baseline.json'")
    expect(config).toContain("format: 'auto'")
    expect(config).not.toContain('project:')
    expect(config).not.toContain('watchDirs')
  })

  it('threads a non-src source root into the preset include and message', () => {
    const dir = makeProject({
      tsconfigInclude: ['lib'],
      srcFiles: { 'lib/a.ts': 'export const a = 1\n' },
    })
    const out = captureStdout()
    runInit({ cwd: dir })
    const text = out.text()
    out.restore()
    const rules = read(dir, 'arch.rules.ts')
    expect(rules).toContain("recommended(p, { include: '**/lib/**' })")
    expect(text).toContain('source under lib/')
  })

  it('refuses to overwrite existing files and names --force / --dry-run', () => {
    const dir = makeProject()
    fs.writeFileSync(path.join(dir, 'arch.rules.ts'), 'pre-existing\n')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const code = runInit({ cwd: dir })
    expect(code).toBe(1)
    const msg = errSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(msg).toContain('arch.rules.ts')
    expect(msg).toContain('--force')
    expect(msg).toContain('--dry-run')
    // nothing else written
    expect(fs.existsSync(path.join(dir, 'ts-archunit.config.ts'))).toBe(false)
    // the existing file is untouched
    expect(read(dir, 'arch.rules.ts')).toBe('pre-existing\n')
  })

  it('--force overwrites an existing file', () => {
    const dir = makeProject()
    fs.writeFileSync(path.join(dir, 'arch.rules.ts'), 'pre-existing\n')
    const out = captureStdout()
    const code = runInit({ cwd: dir, force: true })
    out.restore()
    expect(code).toBe(0)
    expect(read(dir, 'arch.rules.ts')).toContain('...recommended(p)')
  })

  it('--dry-run writes nothing and prints the plan', () => {
    const dir = makeProject()
    const out = captureStdout()
    const code = runInit({ cwd: dir, dryRun: true })
    const text = out.text()
    out.restore()
    expect(code).toBe(0)
    expect(text).toContain('Dry run')
    expect(text).toContain('arch.rules.ts')
    expect(fs.existsSync(path.join(dir, 'arch.rules.ts'))).toBe(false)
  })

  it('--no-baseline skips the baseline file and omits the config field', () => {
    const dir = makeProject()
    const out = captureStdout()
    runInit({ cwd: dir, noBaseline: true })
    out.restore()
    expect(fs.existsSync(path.join(dir, 'arch-baseline.json'))).toBe(false)
    expect(read(dir, 'ts-archunit.config.ts')).not.toContain('baseline:')
  })

  it('brownfield message states warnings never fail CI and the baseline-before-CI step', () => {
    const dir = makeProject({ srcFiles: { 'src/a.ts': 'export const a = 1\n' } })
    const out = captureStdout()
    runInit({ cwd: dir })
    const text = out.text()
    out.restore()
    expect(text).toContain('never fail CI')
    expect(text).toContain('arch:baseline')
  })

  it('greenfield message is a plain next-step, no baseline nag', () => {
    const dir = makeProject() // no src dir
    const out = captureStdout()
    runInit({ cwd: dir })
    const text = out.text()
    out.restore()
    expect(text).toContain('Next:')
    expect(text).not.toContain('never fail CI')
  })

  it('missing tsconfig exits 1 with an actionable message and writes nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsau-init-'))
    tmpDirs.push(dir)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const code = runInit({ cwd: dir })
    expect(code).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('tsc --init'))
    expect(fs.existsSync(path.join(dir, 'arch.rules.ts'))).toBe(false)
  })

  it('no package.json: generates files, skips scripts, message points at npx', () => {
    const dir = makeProject({ packageJson: null })
    const out = captureStdout()
    const code = runInit({ cwd: dir })
    const text = out.text()
    out.restore()
    expect(code).toBe(0)
    expect(fs.existsSync(path.join(dir, 'arch.rules.ts'))).toBe(true)
    expect(text).toContain('npx ts-archunit check')
    expect(text).not.toContain('npm run arch')
  })

  it('unparseable package.json: skips script entry gracefully, still writes files', () => {
    const dir = makeProject({ packageJson: '{ "name": "x", /* oops */ } trailing junk' })
    const out = captureStdout()
    const code = runInit({ cwd: dir })
    const text = out.text()
    out.restore()
    expect(code).toBe(0)
    expect(fs.existsSync(path.join(dir, 'arch.rules.ts'))).toBe(true)
    expect(text.toLowerCase()).toContain('skipped')
  })

  it('package.json merge preserves indent and no-trailing-newline, only adds scripts', () => {
    // 4-space indent, no trailing newline.
    const original = '{\n    "name": "x",\n    "version": "1.0.0"\n}'
    const dir = makeProject({ packageJson: original })
    const out = captureStdout()
    runInit({ cwd: dir })
    out.restore()
    const merged = read(dir, 'package.json')
    expect(merged).toContain('    "scripts": {')
    expect(merged).toContain('        "arch": "ts-archunit check"')
    expect(merged.endsWith('}')).toBe(true) // no trailing newline added
    // original fields + order intact
    expect(merged.indexOf('"name"')).toBeLessThan(merged.indexOf('"version"'))
    expect(merged.indexOf('"version"')).toBeLessThan(merged.indexOf('"scripts"'))
  })

  it('skips the script merge when an arch script already exists', () => {
    const dir = makeProject({
      packageJson: JSON.stringify({ name: 'x', scripts: { arch: 'echo mine' } }, null, 2),
    })
    const out = captureStdout()
    runInit({ cwd: dir })
    out.restore()
    expect(read(dir, 'package.json')).toContain('echo mine')
  })

  it('--dry-run previews over existing files instead of erroring (no conflict wall)', () => {
    const dir = makeProject()
    fs.writeFileSync(path.join(dir, 'arch.rules.ts'), 'pre-existing\n')
    const out = captureStdout()
    const code = runInit({ cwd: dir, dryRun: true })
    const text = out.text()
    out.restore()
    expect(code).toBe(0)
    expect(text).toContain('Dry run')
    expect(text).toContain('exists — needs --force')
    expect(read(dir, 'arch.rules.ts')).toBe('pre-existing\n') // untouched
  })

  it('threads a custom --tsconfig path into the generated files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsau-init-'))
    tmpDirs.push(dir)
    fs.mkdirSync(path.join(dir, 'config'))
    fs.writeFileSync(
      path.join(dir, 'config', 'tsconfig.build.json'),
      JSON.stringify({ include: ['src'] }, null, 2),
    )
    const out = captureStdout()
    const code = runInit({ cwd: dir, tsconfig: 'config/tsconfig.build.json' })
    out.restore()
    expect(code).toBe(0)
    expect(read(dir, 'arch.rules.ts')).toContain("project('config/tsconfig.build.json')")
    expect(read(dir, 'ts-archunit.config.ts')).toContain('config/tsconfig.build.json')
  })

  it('reports a write failure (target path is a directory) and returns 1', () => {
    const dir = makeProject()
    fs.mkdirSync(path.join(dir, 'arch-baseline.json')) // collide: a dir where a file goes
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const out = captureStdout()
    const code = runInit({ cwd: dir, force: true }) // force skips conflict check → hits write
    out.restore()
    expect(code).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('could not write'))
  })
})

describe('runInit source-root detection', () => {
  function writeRawTsconfig(raw: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsau-init-'))
    tmpDirs.push(dir)
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), raw)
    return dir
  }

  it('detects the root from a JSONC tsconfig (comments + trailing comma)', () => {
    const dir = writeRawTsconfig(`{
      // build config
      "compilerOptions": { "strict": true },
      "include": ["app"], /* app sources */
    }`)
    const out = captureStdout()
    runInit({ cwd: dir })
    out.restore()
    expect(read(dir, 'arch.rules.ts')).toContain("include: '**/app/**'")
  })

  it('falls back to compilerOptions.rootDir when include is absent', () => {
    const dir = writeRawTsconfig(JSON.stringify({ compilerOptions: { rootDir: 'source' } }))
    const out = captureStdout()
    runInit({ cwd: dir })
    out.restore()
    expect(read(dir, 'arch.rules.ts')).toContain("include: '**/source/**'")
  })

  it('falls back to src when include is glob-first with no literal root', () => {
    const dir = writeRawTsconfig(JSON.stringify({ include: ['**/*.ts'] }))
    const out = captureStdout()
    runInit({ cwd: dir })
    out.restore()
    // src is the preset default, so the call is bare (no include option)
    const rules = read(dir, 'arch.rules.ts')
    expect(rules).toContain('...recommended(p),')
    expect(rules).not.toContain('include:')
  })

  it('strips a leading ./ from the include entry', () => {
    const dir = writeRawTsconfig(JSON.stringify({ include: ['./lib'] }))
    const out = captureStdout()
    runInit({ cwd: dir })
    out.restore()
    expect(read(dir, 'arch.rules.ts')).toContain("include: '**/lib/**'")
  })

  it('falls back to src on an unparseable tsconfig', () => {
    const dir = writeRawTsconfig('this is not json at all }{')
    const out = captureStdout()
    runInit({ cwd: dir })
    out.restore()
    const rules = read(dir, 'arch.rules.ts')
    expect(rules).toContain('...recommended(p),')
    expect(rules).not.toContain('include:')
  })
})

describe('generated arch.rules.ts is valid TypeScript', () => {
  function assertValidRuleFile(dir: string): void {
    const proj = new Project({ useInMemoryFileSystem: true })
    const sf = proj.createSourceFile('arch.rules.ts', read(dir, 'arch.rules.ts'))
    // Syntactic diagnostics only — unresolved '@nielspeter/...' imports are
    // semantic and expected in this in-memory project.
    const syntactic = proj.getProgram().compilerObject.getSyntacticDiagnostics(sf.compilerNode)
    expect(syntactic).toHaveLength(0)
    // The default export must be an array literal of builders.
    const expr = sf.getExportAssignment((e) => !e.isExportEquals())?.getExpression()
    expect(expr !== undefined && Node.isArrayLiteralExpression(expr)).toBe(true)
  }

  it('recommended preset emits a syntactically valid array-default rule file', () => {
    const dir = makeProject()
    const out = captureStdout()
    runInit({ cwd: dir })
    out.restore()
    assertValidRuleFile(dir)
  })

  it('agent-guardrails preset emits a syntactically valid file with the enabled flags', () => {
    const dir = makeProject()
    const out = captureStdout()
    runInit({ cwd: dir, preset: 'agent-guardrails' })
    out.restore()
    assertValidRuleFile(dir)
    // content-drift guard: the enabled options are actually present
    const rules = read(dir, 'arch.rules.ts')
    expect(rules).toContain('noGenericErrors: true')
    expect(rules).toContain('noCopyPaste: true')
  })
})

// Drift guard: the templates embed these exact option objects. Calling the real
// presets with them here means any signature drift breaks THIS file's typecheck.
describe('template option shapes stay valid against the presets', () => {
  const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/presets/recommended')
  function loadProject(): ArchProject {
    const tsMorph = new Project({ tsConfigFilePath: path.join(fixturesDir, 'tsconfig.json') })
    return {
      tsConfigPath: path.join(fixturesDir, 'tsconfig.json'),
      _project: tsMorph,
      getSourceFiles: () => tsMorph.getSourceFiles(),
    }
  }

  it('recommended and agentGuardrails accept the generated option objects', () => {
    const p = loadProject()
    expect(recommended(p, { include: '**/lib/**' }).length).toBeGreaterThan(0)
    expect(
      agentGuardrails(p, {
        src: 'src/**',
        noGenericErrors: true,
        noStubs: true,
        noEmptyBodies: true,
        noCopyPaste: true,
      }).length,
    ).toBeGreaterThan(0)
  })
})
