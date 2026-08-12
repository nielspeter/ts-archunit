/**
 * A `workspace()` judges each package by **its own** tsconfig —
 * [bug 0058](../../bugs/fixed/0058-workspace-applies-one-packages-compiler-flag-to-all.md).
 *
 * `workspace()` builds ONE ts-morph `Project` from the alphabetically-first tsconfig and
 * then only *adds files* from the rest. So before this fix,
 * `sourceFile.getProject().getCompilerOptions()` answered for the tie-break winner
 * whatever package a file was actually in, and `beFreeOfCycles` was wrong in **both**
 * directions depending on a path sort:
 *
 * - primary flag OFF → the flag-`true` package's real cycle **vanished**;
 * - primary flag ON  → the flag-`false` package got a **phantom** cycle, which reds CI
 *   with a remedy ("extract shared code to a lower-level module") that cannot remediate
 *   it, because there is nothing to extract. An agent handed that restructures working
 *   code.
 *
 * Two fixture pairs, because **one pair cannot test this**: `verbatim-module-syntax` and
 * `verbatim-module-syntax-off` always sort with `-off` first (`'-' < '/'`), so that pair
 * only ever exercises one primary. `zz-aa-verbatim-on` / `zz-bb-verbatim-off` force the
 * other. Both directions or the fix passes half the time — a fix that reads the *last*
 * config instead of the first would satisfy a single-order test.
 *
 * All four fixtures carry byte-identical sources; only the tsconfigs differ.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { workspace, project } from '../../src/core/project.js'
import type { ArchProject } from '../../src/core/project.js'
import { slices } from '../../src/builders/slice-rule-builder.js'
import { edgesOf } from '../../src/core/module-edges.js'

const FIXTURES = path.resolve(import.meta.dirname, '../fixtures')
const cfg = (name: string): string => path.join(FIXTURES, name, 'tsconfig.json')

const ON = 'verbatim-module-syntax'
const OFF = 'verbatim-module-syntax-off'
const ON_FIRST = 'zz-aa-verbatim-on'
const OFF_SECOND = 'zz-bb-verbatim-off'

/** Cycles reported for the slices inside one package of a loaded project. */
function cyclesIn(p: ArchProject, fixture: string): string[] {
  const under = `**/${fixture}/src`
  return slices(p)
    .assignedFrom({ a: `${under}/a/**`, b: `${under}/b/**` })
    .should()
    .beFreeOfCycles()
    .violations()
    .filter((v) => v.bypassFilters !== true)
    .map((v) => v.element)
}

describe('workspace() resolves verbatimModuleSyntax per package (bug 0058)', () => {
  it('VACUITY: the four fixtures share source and differ only in the flag', () => {
    // Without this the rows below could pass because two fixtures happen to disagree for
    // an unrelated reason — and the whole claim is "the tsconfig is the only difference".
    const read = (name: string, rel: string): string =>
      fs.readFileSync(path.join(FIXTURES, name, 'src', rel), 'utf-8')
    for (const rel of ['a/index.ts', 'b/index.ts']) {
      const canonical = read(ON, rel)
      for (const other of [OFF, ON_FIRST, OFF_SECOND]) {
        expect(read(other, rel)).toBe(canonical)
      }
    }
    const flag = (name: string): boolean =>
      fs.readFileSync(cfg(name), 'utf-8').includes('"verbatimModuleSyntax": true')
    expect([ON, OFF, ON_FIRST, OFF_SECOND].map(flag)).toEqual([true, false, true, false])
  })

  it('each package alone gives the right answer — the control', () => {
    expect(cyclesIn(project(cfg(ON)), ON)).toEqual(['a -> b', 'b -> a'])
    expect(cyclesIn(project(cfg(OFF)), OFF)).toEqual([])
  })

  it('primary OFF: the flag-true package still reports its cycle', () => {
    // Was a FALSE NEGATIVE — the real cycle vanished, because the primary's `false`
    // was applied to a package whose own tsconfig says `true`.
    const ws = workspace([cfg(ON), cfg(OFF)])
    expect(cyclesIn(ws, ON)).toEqual(['a -> b', 'b -> a'])
    expect(cyclesIn(ws, OFF)).toEqual([])
  })

  it('primary ON: the flag-false package still reports nothing', () => {
    // Was a FALSE POSITIVE, and the worse half: a phantom cycle that cannot exist at
    // runtime, whose remedy cannot be applied.
    const ws = workspace([cfg(ON_FIRST), cfg(OFF_SECOND)])
    expect(cyclesIn(ws, OFF_SECOND)).toEqual([])
    expect(cyclesIn(ws, ON_FIRST)).toEqual(['a -> b', 'b -> a'])
  })

  it('the edge classification itself is per package, not just the cycle verdict', () => {
    // One level below the condition, so a future caller of `edgesOf` inherits the fix
    // rather than re-deriving it. `erasesModuleRequest` is the field bug 0058 corrupted.
    const ws = workspace([cfg(ON), cfg(OFF)])
    const erasesFor = (fixture: string): boolean[] =>
      ws
        .getSourceFiles()
        .filter((sf) => sf.getFilePath().includes(`/${fixture}/src/a/`))
        .flatMap((sf) => edgesOf(sf).filter((e) => e.kind === 'import'))
        .map((e) => e.erasesModuleRequest)

    // The same statement, in byte-identical files: erased in the package whose tsconfig
    // says so, and a live module request in the one whose tsconfig says so.
    expect(erasesFor(ON)).toEqual([false])
    expect(erasesFor(OFF)).toEqual([true])
  })

  it('a UNIFORM workspace is unaffected', () => {
    // Per-file resolution must not break the common case, where every package agrees.
    const ws = workspace([cfg(ON), cfg(ON_FIRST)])
    expect(cyclesIn(ws, ON)).toEqual(['a -> b', 'b -> a'])
    expect(cyclesIn(ws, ON_FIRST)).toEqual(['a -> b', 'b -> a'])
  })
})
