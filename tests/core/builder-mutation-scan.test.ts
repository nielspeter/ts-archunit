/**
 * The detectors that guard bug 0016 are themselves guarded here.
 *
 * `held-builder-is-immutable.test.ts` points two source-level detectors at
 * `src/` and asserts they report nothing. That assertion holds both when the
 * code is clean and when the detector is broken, and the second one had
 * happened twice:
 *
 *   - `mutatedInPlace` required `this._x.push(...)`. Every mutation had been
 *     rewritten to `next._x.push(...)`, so it matched 0 of 32 fields. Emptying
 *     its mutator list failed no test.
 *   - `mutatesThenReturnsThis` required a literal `return this`, so
 *     `const next = this; next._x.push(y); return next` — a complete revert of
 *     one fixed method — passed all 2340 tests.
 *
 * Every case below states its expected verdict from the fixture in front of it,
 * so a broken detector disagrees with something (ADR-008 rule 5). The fixtures
 * are in-memory: no disk, no repo load, and no way for a change in `src/` to
 * quietly change what this file is testing.
 */
import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'
import type { ClassDeclaration } from 'ts-morph'
import {
  copiesContainer,
  mutatedInPlace,
  mutatesThenReturnsThis,
} from '../helpers/builder-mutation-scan.js'

function classFrom(source: string): ClassDeclaration {
  const project = new Project({ useInMemoryFileSystem: true })
  const file = project.createSourceFile('fixture.ts', source)
  const cls = file.getClasses()[0]
  if (!cls) throw new Error('fixture declares no class')
  return cls
}

function method(source: string, name: string) {
  const found = classFrom(source).getMethod(name)
  if (!found) throw new Error(`fixture has no method ${name}`)
  return found
}

describe('mutatesThenReturnsThis — hands the receiver back after editing it', () => {
  it('flags the classic idiom: assign to own state, return this', () => {
    const src = `class B {
      private _n = 0
      withN(n: number): this { this._n = n; return this }
    }`
    expect(mutatesThenReturnsThis(method(src, 'withN'))).toBe('assigns this._n')
  })

  it('flags a push onto own state before returning this', () => {
    const src = `class B {
      private _items: string[] = []
      add(x: string): this { this._items.push(x); return this }
    }`
    expect(mutatesThenReturnsThis(method(src, 'add'))).toBe('calls this._items.push()')
  })

  it('flags the aliased receiver — `const next = this`, then return next', () => {
    // This is the shape that made the shipped detector miss a full revert of
    // CorrespondenceBuilder.side(). It reads like copy-on-write and is not.
    const src = `class B {
      private _items: string[] = []
      add(x: string): this { const next = this; next._items.push(x); return next }
    }`
    expect(mutatesThenReturnsThis(method(src, 'add'))).toBe('calls next._items.push()')
  })

  it('accepts genuine copy-on-write via this.copy()', () => {
    const src = `class B {
      private _items: string[] = []
      protected copy(): this { return this }
      add(x: string): this { const next = this.copy(); next._items.push(x); return next }
    }`
    expect(mutatesThenReturnsThis(method(src, 'add'))).toBeUndefined()
  })

  it('accepts copy-on-write via shallowClone(this) and super.copy()', () => {
    const src = `class B {
      private _items: string[] = []
      a(x: string): this { const next = shallowClone(this); next._items.push(x); return next }
      b(x: string): this { const next = super.copy(); next._items.push(x); return next }
    }`
    expect(mutatesThenReturnsThis(method(src, 'a'))).toBeUndefined()
    expect(mutatesThenReturnsThis(method(src, 'b'))).toBeUndefined()
  })

  it('accepts a bare grammar marker that mutates nothing', () => {
    const src = `class B { should(): this { return this } }`
    expect(mutatesThenReturnsThis(method(src, 'should'))).toBeUndefined()
  })

  it('ignores writes to a field without the state prefix', () => {
    // The convention is that builder state is `_`-prefixed. A method writing a
    // public field is out of scope, and must not be reported as a leak.
    const src = `class B {
      count = 0
      bump(): this { this.count += 1; return this }
    }`
    expect(mutatesThenReturnsThis(method(src, 'bump'))).toBeUndefined()
  })

  it('ignores a method that mutates but does not hand the receiver back', () => {
    const src = `class B {
      private _n = 0
      set(n: number): void { this._n = n }
    }`
    expect(mutatesThenReturnsThis(method(src, 'set'))).toBeUndefined()
  })
})

describe('mutatedInPlace — the container is edited, whoever owns it', () => {
  it('flags a mutation written on this', () => {
    const src = `class B {
      private _items: string[] = []
      add(x: string): this { this._items.push(x); return this }
    }`
    expect(mutatedInPlace(classFrom(src), '_items')).toBe(true)
  })

  it('flags a mutation written on a clone — the case the shipped version missed', () => {
    const src = `class B {
      private _items: string[] = []
      add(x: string): this { const next = this.copy(); next._items.push(x); return next }
      protected copy(): this { return this }
    }`
    expect(mutatedInPlace(classFrom(src), '_items')).toBe(true)
  })

  it('covers Set and Map mutators, not just array push', () => {
    const src = `class B {
      private _names = new Set<string>()
      private _byKey = new Map<string, string>()
      addName(n: string): this { const next = this.copy(); next._names.add(n); return next }
      put(k: string, v: string): this { const next = this.copy(); next._byKey.set(k, v); return next }
      protected copy(): this { return this }
    }`
    expect(mutatedInPlace(classFrom(src), '_names')).toBe(true)
    expect(mutatedInPlace(classFrom(src), '_byKey')).toBe(true)
  })

  it('does not flag a field that is only ever replaced wholesale', () => {
    // TsconfigBuilder._requirements is this shape, which is why it correctly
    // needs no copy() override.
    const src = `class B {
      private _req: Record<string, unknown> = {}
      requires(spec: Record<string, unknown>): this {
        const next = this.copy()
        next._req = { ...this._req, ...spec }
        return next
      }
      protected copy(): this { return this }
    }`
    expect(mutatedInPlace(classFrom(src), '_req')).toBe(false)
  })

  it('does not flag a read-only traversal of the container', () => {
    const src = `class B {
      private _items: string[] = []
      describe(): string { return this._items.map((i) => i).join(', ') }
    }`
    expect(mutatedInPlace(classFrom(src), '_items')).toBe(false)
  })
})

describe('copiesContainer — the clone gets a fresh container', () => {
  it('accepts the copy() override spelling', () => {
    const src = `class B {
      private _items: string[] = []
      protected override copy(): this {
        const clone = super.copy()
        clone._items = [...this._items]
        return clone
      }
    }`
    expect(copiesContainer(classFrom(src).getText(), '_items')).toBe(true)
  })

  it('accepts the adoptFilterState spelling, where `this` is the destination', () => {
    const src = `class B {
      private _items: string[] = []
      protected adopt(source: B): void { this._items = [...source._items] }
    }`
    expect(copiesContainer(classFrom(src).getText(), '_items')).toBe(true)
  })

  it('accepts new Set(...) and object spread', () => {
    const src = `class B {
      private _names = new Set<string>()
      private _meta: Record<string, string> = {}
      protected override copy(): this {
        const clone = super.copy()
        clone._names = new Set(this._names)
        clone._meta = { ...this._meta }
        return clone
      }
    }`
    const text = classFrom(src).getText()
    expect(copiesContainer(text, '_names')).toBe(true)
    expect(copiesContainer(text, '_meta')).toBe(true)
  })

  it('rejects an assignment that shares the same container by reference', () => {
    // The defect the second structural guard exists for: a copy() override that
    // looks like it copies and only rebinds the same array.
    const src = `class B {
      private _items: string[] = []
      protected override copy(): this {
        const clone = super.copy()
        clone._items = this._items
        return clone
      }
    }`
    expect(copiesContainer(classFrom(src).getText(), '_items')).toBe(false)
  })

  it('rejects a class that never rebuilds the container at all', () => {
    const src = `class B {
      private _items: string[] = []
      add(x: string): this { const next = this.copy(); next._items.push(x); return next }
      protected copy(): this { return this }
    }`
    expect(copiesContainer(classFrom(src).getText(), '_items')).toBe(false)
  })
})
