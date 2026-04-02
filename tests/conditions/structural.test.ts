import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { Project, SyntaxKind } from 'ts-morph'
import {
  createViolation,
  getElementName,
  getElementFile,
  getElementLine,
} from '../../src/core/violation.js'
import {
  resideInFile,
  resideInFolder,
  haveNameMatching,
  beExported,
  notExist,
} from '../../src/conditions/structural.js'

// --- In-memory ts-morph project for unit tests ---

function createInMemoryProject() {
  return new Project({ useInMemoryFileSystem: true })
}

// --- Load PoC fixtures for integration tests ---

const fixturesDir = path.resolve(import.meta.dirname, '../fixtures/poc')
const tsconfigPath = path.join(fixturesDir, 'tsconfig.json')
const fixtureProject = new Project({ tsConfigFilePath: tsconfigPath })

describe('ArchViolation structure', () => {
  it('createViolation produces correct fields', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('src/test.ts', 'export class Foo {}')
    const cls = sf.getClasses()[0]!
    const violation = createViolation(cls, 'bad thing happened', {
      rule: 'test rule',
      because: 'testing',
    })
    expect(violation.rule).toBe('test rule')
    expect(violation.element).toBe('Foo')
    expect(violation.file).toContain('test.ts')
    expect(violation.line).toBe(1)
    expect(violation.message).toBe('bad thing happened')
    expect(violation.because).toBe('testing')
  })

  it('createViolation omits because when undefined', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('src/test.ts', 'export class Bar {}')
    const cls = sf.getClasses()[0]!
    const violation = createViolation(cls, 'bad', { rule: 'r' })
    expect(violation.because).toBeUndefined()
  })
})

describe('element metadata helpers', () => {
  it('getElementName returns class name', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'class MyClass {}')
    const cls = sf.getClasses()[0]!
    expect(getElementName(cls)).toBe('MyClass')
  })

  it('getElementName returns function name', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'function doStuff() {}')
    const fn = sf.getFunctions()[0]!
    expect(getElementName(fn)).toBe('doStuff')
  })

  it('getElementName returns variable name', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'const myVar = 42')
    const varDecl = sf.getVariableDeclarations()[0]!
    expect(getElementName(varDecl)).toBe('myVar')
  })

  it('getElementName falls back to kind name for top-level nodes', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', '1 + 2')
    const stmt = sf.getStatements()[0]!
    expect(getElementName(stmt)).toBe('ExpressionStatement')
  })

  // --- BUG-0008: ancestor walking for inner nodes ---

  it('getElementName walks up to ClassName.methodName for inner nodes', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile(
      't.ts',
      'class MyService { doWork() { const x = 1 as number; } }',
    )
    const cls = sf.getClasses()[0]!
    const method = cls.getMethods()[0]!
    const body = method.getBody()!
    const asExpr = body.getDescendantsOfKind(SyntaxKind.AsExpression)[0]!
    expect(getElementName(asExpr)).toBe('MyService.doWork')
  })

  it('getElementName returns function name for inner nodes in standalone functions', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'function handler() { const x = 1 as number; }')
    const fn = sf.getFunctions()[0]!
    const body = fn.getBody()!
    const asExpr = body.getDescendantsOfKind(SyntaxKind.AsExpression)[0]!
    expect(getElementName(asExpr)).toBe('handler')
  })

  it('getElementName handles constructors: ClassName.constructor', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile(
      't.ts',
      'class Config { constructor() { const x = 1 as number; } }',
    )
    const cls = sf.getClasses()[0]!
    const ctor = cls.getConstructors()[0]!
    // Constructor node itself
    expect(getElementName(ctor)).toBe('constructor')
    // Inner node inside constructor
    const body = ctor.getBody()!
    const asExpr = body.getDescendantsOfKind(SyntaxKind.AsExpression)[0]!
    expect(getElementName(asExpr)).toBe('Config.constructor')
  })

  it('getElementName handles getters: ClassName.getterName', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'class Svc { get value() { return 1 as number; } }')
    const cls = sf.getClasses()[0]!
    const getter = cls.getGetAccessors()[0]!
    expect(getElementName(getter)).toBe('value')
    // Inner node inside getter
    const body = getter.getBody()!
    const asExpr = body.getDescendantsOfKind(SyntaxKind.AsExpression)[0]!
    expect(getElementName(asExpr)).toBe('Svc.value')
  })

  it('getElementName handles setters: ClassName.setterName', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile(
      't.ts',
      'class Svc { set value(v: unknown) { const x = v as string; } }',
    )
    const cls = sf.getClasses()[0]!
    const setter = cls.getSetAccessors()[0]!
    expect(getElementName(setter)).toBe('value')
    const body = setter.getBody()!
    const asExpr = body.getDescendantsOfKind(SyntaxKind.AsExpression)[0]!
    expect(getElementName(asExpr)).toBe('Svc.value')
  })

  it('getElementName handles arrow functions assigned to variables', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'const handler = () => { const x = 1 as number; }')
    const arrow = sf.getDescendantsOfKind(SyntaxKind.ArrowFunction)[0]!
    const body = arrow.getBody()
    const asExpr = body.getDescendantsOfKind(SyntaxKind.AsExpression)[0]!
    expect(getElementName(asExpr)).toBe('handler')
  })

  it('getElementName handles arrow functions inside class methods', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile(
      't.ts',
      'class Svc { run() { const cb = () => { const x = 1 as number; }; } }',
    )
    const asExpr = sf.getDescendantsOfKind(SyntaxKind.AsExpression)[0]!
    expect(getElementName(asExpr)).toBe('Svc.run.cb')
  })

  it('getElementName handles function expressions assigned to variables', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile(
      't.ts',
      'const handler = function() { const x = 1 as number; }',
    )
    const asExpr = sf.getDescendantsOfKind(SyntaxKind.AsExpression)[0]!
    expect(getElementName(asExpr)).toBe('handler')
  })

  it('getElementName handles property initializers: ClassName.propName', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'class Foo { bar = 1 as number; }')
    const asExpr = sf.getDescendantsOfKind(SyntaxKind.AsExpression)[0]!
    expect(getElementName(asExpr)).toBe('Foo.bar')
  })

  it('getElementName handles anonymous classes: returns method name only', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile(
      't.ts',
      'export default class { doWork() { const x = 1 as number; } }',
    )
    const asExpr = sf.getDescendantsOfKind(SyntaxKind.AsExpression)[0]!
    // Anonymous class has no name — only the method name is collected
    expect(getElementName(asExpr)).toBe('doWork')
  })

  it('getElementFile returns absolute path', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('/src/foo.ts', 'class A {}')
    const cls = sf.getClasses()[0]!
    expect(getElementFile(cls)).toBe('/src/foo.ts')
  })

  it('getElementLine returns start line', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', '\n\nclass A {}')
    const cls = sf.getClasses()[0]!
    expect(getElementLine(cls)).toBe(3)
  })
})

describe('resideInFile()', () => {
  it('passes when element is in matching file', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('/src/services/order.ts', 'export class OrderService {}')
    const cls = sf.getClasses()[0]!
    const cond = resideInFile('**/services/*.ts')
    const violations = cond.evaluate([cls], { rule: 'test' })
    expect(violations).toHaveLength(0)
  })

  it('produces violation when element is in non-matching file', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('/src/routes/order.ts', 'export class OrderRoute {}')
    const cls = sf.getClasses()[0]!
    const cond = resideInFile('**/services/*.ts')
    const violations = cond.evaluate([cls], { rule: 'test' })
    expect(violations).toHaveLength(1)
  })

  it('violation message includes file path and glob', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('/src/routes/order.ts', 'export class OrderRoute {}')
    const cls = sf.getClasses()[0]!
    const cond = resideInFile('**/services/*.ts')
    const violations = cond.evaluate([cls], { rule: 'test' })
    expect(violations[0]?.message).toContain('/src/routes/order.ts')
    expect(violations[0]?.message).toContain('**/services/*.ts')
  })
})

describe('resideInFolder()', () => {
  it('passes when element is in matching folder', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('/src/services/order.ts', 'export class OrderService {}')
    const cls = sf.getClasses()[0]!
    const cond = resideInFolder('**/services')
    const violations = cond.evaluate([cls], { rule: 'test' })
    expect(violations).toHaveLength(0)
  })

  it('produces violation for wrong folder', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('/src/routes/order.ts', 'export class OrderRoute {}')
    const cls = sf.getClasses()[0]!
    const cond = resideInFolder('**/services')
    const violations = cond.evaluate([cls], { rule: 'test' })
    expect(violations).toHaveLength(1)
  })

  it('handles deeply nested folders', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile(
      '/src/api/v2/services/order.ts',
      'export class OrderService {}',
    )
    const cls = sf.getClasses()[0]!
    const cond = resideInFolder('**/services')
    const violations = cond.evaluate([cls], { rule: 'test' })
    expect(violations).toHaveLength(0)
  })
})

describe('haveNameMatching()', () => {
  it('passes for matching name', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'class OrderService {}')
    const cls = sf.getClasses()[0]!
    const cond = haveNameMatching(/Service$/)
    const violations = cond.evaluate([cls], { rule: 'test' })
    expect(violations).toHaveLength(0)
  })

  it('produces violation for non-matching name', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'class OrderHelper {}')
    const cls = sf.getClasses()[0]!
    const cond = haveNameMatching(/Service$/)
    const violations = cond.evaluate([cls], { rule: 'test' })
    expect(violations).toHaveLength(1)
  })

  it('works with complex regex', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile(
      't.ts',
      'function getItems() {}\nfunction setName() {}\nfunction findUser() {}\nfunction doStuff() {}',
    )
    const fns = sf.getFunctions()
    const cond = haveNameMatching(/^(get|set|find)\w+$/)
    const violations = cond.evaluate(fns, { rule: 'test' })
    // doStuff does not match
    expect(violations).toHaveLength(1)
    expect(violations[0]?.element).toBe('doStuff')
  })
})

describe('beExported()', () => {
  it('passes for exported class', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'export class Foo {}')
    const cls = sf.getClasses()[0]!
    const violations = beExported().evaluate([cls], { rule: 'test' })
    expect(violations).toHaveLength(0)
  })

  it('produces violation for non-exported class', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'class Foo {}')
    const cls = sf.getClasses()[0]!
    const violations = beExported().evaluate([cls], { rule: 'test' })
    expect(violations).toHaveLength(1)
  })

  it('passes for exported function', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'export function foo() {}')
    const fn = sf.getFunctions()[0]!
    const violations = beExported().evaluate([fn], { rule: 'test' })
    expect(violations).toHaveLength(0)
  })

  it('produces violation for non-exported function', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'function foo() {}')
    const fn = sf.getFunctions()[0]!
    const violations = beExported().evaluate([fn], { rule: 'test' })
    expect(violations).toHaveLength(1)
  })

  it('passes for exported const', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'export const foo = () => {}')
    const varDecl = sf.getVariableDeclarations()[0]!
    const violations = beExported().evaluate([varDecl], { rule: 'test' })
    expect(violations).toHaveLength(0)
  })

  it('produces violation for non-exported const', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'const foo = () => {}')
    const varDecl = sf.getVariableDeclarations()[0]!
    const violations = beExported().evaluate([varDecl], { rule: 'test' })
    expect(violations).toHaveLength(1)
  })
})

describe('notExist()', () => {
  it('returns no violations when element set is empty', () => {
    const violations = notExist().evaluate([], { rule: 'test' })
    expect(violations).toHaveLength(0)
  })

  it('returns violation for each existing element', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'class A {}\nclass B {}\nclass C {}')
    const classes = sf.getClasses()
    const violations = notExist().evaluate(classes, { rule: 'test' })
    expect(violations).toHaveLength(3)
  })

  it('violation message says "should not exist"', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'class Foo {}')
    const cls = sf.getClasses()[0]!
    const violations = notExist().evaluate([cls], { rule: 'test' })
    expect(violations[0]?.message).toContain('should not exist')
  })

  it('includes because in violations when provided', () => {
    const proj = createInMemoryProject()
    const sf = proj.createSourceFile('t.ts', 'class Foo {}')
    const cls = sf.getClasses()[0]!
    const violations = notExist().evaluate([cls], {
      rule: 'test',
      because: 'use shared utility',
    })
    expect(violations[0]?.because).toBe('use shared utility')
  })
})

describe('against PoC fixtures', () => {
  it('resideInFile matches PoC service files', () => {
    const classes = fixtureProject.getSourceFiles().flatMap((sf) => sf.getClasses())
    const cond = resideInFile('**/*-service.ts')
    const violations = cond.evaluate(classes, { rule: 'test' })
    // Classes not in *-service.ts files should produce violations
    // DomainError and BaseService are in base-service.ts (matches), domain.ts classes etc.
    const violatingNames = violations.map((v) => v.element)
    // EdgeCaseService is in edge-cases.ts — NOT a *-service.ts file
    expect(violatingNames).toContain('EdgeCaseService')
  })

  it('beExported detects non-exported fixture classes', () => {
    const optionsFile = fixtureProject
      .getSourceFiles()
      .find((sf) => sf.getBaseName() === 'options.ts')
    expect(optionsFile).toBeDefined()
    const interfaces = optionsFile!.getInterfaces()
    const strictOptions = interfaces.find((i) => i.getName() === 'StrictOptions')
    expect(strictOptions).toBeDefined()
    const violations = beExported().evaluate([strictOptions!], { rule: 'test' })
    expect(violations).toHaveLength(1)
    expect(violations[0]?.element).toBe('StrictOptions')
  })

  it('notExist with PoC routes', () => {
    const routesFile = fixtureProject
      .getSourceFiles()
      .find((sf) => sf.getBaseName() === 'routes.ts')
    expect(routesFile).toBeDefined()
    const functions = routesFile!.getFunctions()
    const parseFns = functions.filter(
      (f) => f.getName() === 'parseFooOrder' || f.getName() === 'parseBarOrder',
    )
    expect(parseFns).toHaveLength(2)
    const violations = notExist().evaluate(parseFns, {
      rule: 'no parse*Order functions',
      because: 'use shared parseOrder() utility instead',
    })
    expect(violations).toHaveLength(2)
    const names = violations.map((v) => v.element)
    expect(names).toContain('parseFooOrder')
    expect(names).toContain('parseBarOrder')
  })
})
