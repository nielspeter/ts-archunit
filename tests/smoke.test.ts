import { describe, it, expect } from 'vitest'
import { Project } from 'ts-morph'

describe('smoke test', () => {
  it('ts-morph loads a project', () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const sourceFile = project.createSourceFile('test.ts', 'export class Foo extends Bar {}')
    const classes = sourceFile.getClasses()
    expect(classes).toHaveLength(1)

    const cls = classes[0]!
    expect(cls.getName()).toBe('Foo')
    expect(cls.getExtends()?.getText()).toBe('Bar')
  })
})
