import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Project, ScriptTarget, ModuleKind } from 'ts-morph'
import type { CompilerOptions } from 'ts-morph'
import type { ArchProject } from '../../src/core/project.js'
import { tsconfig } from '../../src/tsconfig/index.js'
import { workspace, resetProjectCache } from '../../src/core/project.js'
import { STRICT_FAMILY_SIZE } from '../../src/tsconfig/strict-family.js'
import { generateBaseline, withBaseline } from '../../src/helpers/baseline.js'

const tmpDirs: string[] = []

/** In-memory ArchProject with the given compiler options (no extends). */
function mk(opts: CompilerOptions): ArchProject {
  const p = new Project({ useInMemoryFileSystem: true, compilerOptions: opts })
  return {
    tsConfigPath: '/mem/tsconfig.json',
    _project: p,
    getSourceFiles: () => p.getSourceFiles(),
  }
}

/** Write a set of tsconfig files to a fresh temp dir; return the dir. */
function tmpProject(files: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsau-cfg-'))
  tmpDirs.push(dir)
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(content, null, 2))
  }
  return dir
}

/** ArchProject loaded from a real tsconfig on disk (for `extends` resolution). */
function fromDisk(tsconfigPath: string): ArchProject {
  const p = new Project({ tsConfigFilePath: tsconfigPath })
  return {
    tsConfigPath: tsconfigPath,
    _project: p,
    getSourceFiles: () => p.getSourceFiles(),
  }
}

function flags(builder: ReturnType<typeof tsconfig>): string[] {
  return builder.violations().map((v) => v.element)
}

afterEach(() => {
  resetProjectCache()
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('tsconfig().requires — direct flags', () => {
  it('passes when the required flag matches', () => {
    expect(
      tsconfig(mk({ strict: true }))
        .requires({ strict: true })
        .violations(),
    ).toHaveLength(0)
  })

  it('flags an explicit mismatch with expected/actual in the message', () => {
    const v = tsconfig(mk({ strict: false }))
      .requires({ strict: true })
      .violations()
    expect(v).toHaveLength(1)
    expect(v[0]?.element).toBe('strict')
    expect(v[0]?.message).toContain('required true')
    expect(v[0]?.message).toContain('actual false')
  })

  it('flags an unset required flag as "(unset)"', () => {
    const v = tsconfig(mk({})).requires({ strict: true }).violations()
    expect(v).toHaveLength(1)
    expect(v[0]?.message).toContain('(unset)')
    expect(v[0]?.suggestion).toContain('"strict": true')
  })

  it('only checks the flags that were required', () => {
    // strictNullChecks is false, but only strict was required.
    const v = tsconfig(mk({ strict: true, strictNullChecks: false }))
      .requires({ strict: true })
      .violations()
    expect(v).toHaveLength(0)
  })

  it('a non-strict-family flag must be explicit (not implied by strict)', () => {
    const v = tsconfig(mk({ strict: true }))
      .requires({ noUncheckedIndexedAccess: true })
      .violations()
    expect(v).toHaveLength(1)
    expect(v[0]?.element).toBe('noUncheckedIndexedAccess')
  })
})

describe('tsconfig().requires — strict-family resolution', () => {
  it('strict: true implies a strict-family sub-flag', () => {
    const v = tsconfig(mk({ strict: true }))
      .requires({ strictNullChecks: true })
      .violations()
    expect(v).toHaveLength(0)
  })

  it('an explicit sub-flag override wins over strict', () => {
    const v = tsconfig(mk({ strict: true, strictNullChecks: false }))
      .requires({ strictNullChecks: true })
      .violations()
    expect(v).toHaveLength(1)
    expect(v[0]?.element).toBe('strictNullChecks')
  })

  it('an explicit sub-flag without strict satisfies the requirement', () => {
    const v = tsconfig(mk({ strictNullChecks: true }))
      .requires({ strictNullChecks: true })
      .violations()
    expect(v).toHaveLength(0)
  })

  it('STRICT_FAMILY tracks the tsc strict family (guard against TS drift)', () => {
    // Bump this when a TypeScript release adds a strict-governed flag.
    expect(STRICT_FAMILY_SIZE).toBe(9)
  })
})

describe('tsconfig().requires — enums, arrays, and multiple flags', () => {
  it('renders enum-backed options by name in the message', () => {
    const v = tsconfig(mk({ target: ScriptTarget.ES2020 }))
      .requires({ target: ScriptTarget.ES2022 })
      .violations()
    expect(v).toHaveLength(1)
    expect(v[0]?.message).toContain('required ES2022')
    expect(v[0]?.message).toContain('actual ES2020')
  })

  it('passes when an enum-backed option matches', () => {
    const v = tsconfig(mk({ module: ModuleKind.Node16 }))
      .requires({ module: ModuleKind.Node16 })
      .violations()
    expect(v).toHaveLength(0)
  })

  it('deep-compares array-valued options', () => {
    expect(
      tsconfig(mk({ lib: ['es2022'] }))
        .requires({ lib: ['es2022'] })
        .violations(),
    ).toHaveLength(0)
    expect(
      tsconfig(mk({ lib: ['es2020'] }))
        .requires({ lib: ['es2022'] })
        .violations(),
    ).toHaveLength(1)
  })

  it('emits one violation per mismatched flag', () => {
    const v = tsconfig(mk({ strict: false, target: ScriptTarget.ES2020 }))
      .requires({ strict: true, target: ScriptTarget.ES2022 })
      .violations()
    expect(v.map((x) => x.element).sort()).toEqual(['strict', 'target'])
  })

  it('merges multiple .requires() calls additively', () => {
    const v = tsconfig(mk({ strict: false }))
      .requires({ strict: true })
      .requires({ noUncheckedIndexedAccess: true })
      .violations()
    expect(v.map((x) => x.element).sort()).toEqual(['noUncheckedIndexedAccess', 'strict'])
  })
})

describe('tsconfig() — extends resolution', () => {
  it('resolves strict from a parent config (child unset)', () => {
    const dir = tmpProject({
      'base.json': { compilerOptions: { strict: true } },
      'tsconfig.json': { extends: './base.json' },
    })
    const v = tsconfig(fromDisk(path.join(dir, 'tsconfig.json')))
      .requires({ strict: true })
      .violations()
    expect(v).toHaveLength(0)
  })

  it("honors a child's override of a parent flag", () => {
    const dir = tmpProject({
      'base.json': { compilerOptions: { strict: true } },
      'tsconfig.json': { extends: './base.json', compilerOptions: { strict: false } },
    })
    const v = tsconfig(fromDisk(path.join(dir, 'tsconfig.json')))
      .requires({ strict: true })
      .violations()
    expect(v).toHaveLength(1)
  })
})

describe('tsconfig() — terminal-builder integration', () => {
  it('.excluding(flag) filters by flag name', () => {
    const b = tsconfig(mk({ strict: false, target: ScriptTarget.ES2020 }))
      .requires({ strict: true, target: ScriptTarget.ES2022 })
      .excluding('target')
    expect(flags(b)).toEqual(['strict'])
  })

  it('.because() attaches a rationale to the violation', () => {
    const v = tsconfig(mk({ strict: false }))
      .requires({ strict: true })
      .because('ADR-001 requires strict mode')
      .violations()
    expect(v[0]?.because).toBe('ADR-001 requires strict mode')
  })

  it('.check() throws when a requirement is unmet', () => {
    expect(() =>
      tsconfig(mk({ strict: false }))
        .requires({ strict: true })
        .check(),
    ).toThrow()
  })

  it('.asSeverity("warn") stamps the violation severity', () => {
    const v = tsconfig(mk({ strict: false }))
      .requires({ strict: true })
      .asSeverity('warn')
      .violations()
    expect(v[0]?.severity).toBe('warn')
  })

  it('baseline round-trips a file-only violation key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsau-cfg-'))
    tmpDirs.push(dir)
    const baselinePath = path.join(dir, 'arch-baseline.json')
    const rule = () => tsconfig(mk({ strict: false })).requires({ strict: true })
    generateBaseline(rule().violations(), baselinePath)
    // Re-run with the baseline — the known violation is filtered, so no throw.
    expect(() => rule().check({ baseline: withBaseline(baselinePath) })).not.toThrow()
  })
})

describe('tsconfig() — workspace', () => {
  it('asserts against the alphabetically-first tsconfig', () => {
    const dir = tmpProject({
      'a.tsconfig.json': { compilerOptions: { strict: true } },
      'b.tsconfig.json': { compilerOptions: { strict: false } },
    })
    const ws = workspace([path.join(dir, 'b.tsconfig.json'), path.join(dir, 'a.tsconfig.json')])
    // 'a.*' sorts first, so its strict:true wins.
    expect(tsconfig(ws).requires({ strict: true }).violations()).toHaveLength(0)
  })
})
