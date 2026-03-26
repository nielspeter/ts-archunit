import type { ClassDeclaration } from 'ts-morph'
import type { Predicate } from '../core/predicate.js'

/**
 * Matches classes that extend the named base class.
 *
 * Uses the extends clause expression text, e.g. `class Foo extends Bar`
 * matches `extend('Bar')`.
 */
export function extend(className: string): Predicate<ClassDeclaration> {
  return {
    description: `extend "${className}"`,
    test: (cls) => cls.getExtends()?.getExpression().getText() === className,
  }
}

/**
 * Matches classes that have an explicit `implements` clause for the named interface.
 *
 * Checks `getImplements()` expression texts.
 */
export function implement(interfaceName: string): Predicate<ClassDeclaration> {
  return {
    description: `implement "${interfaceName}"`,
    test: (cls) =>
      cls.getImplements().some((impl) => impl.getExpression().getText() === interfaceName),
  }
}

/**
 * Matches classes that have a decorator with the given name.
 *
 * @example haveDecorator('Controller') matches `@Controller class Foo {}`
 */
export function haveDecorator(name: string): Predicate<ClassDeclaration> {
  return {
    description: `have decorator @${name}`,
    test: (cls) => cls.getDecorators().some((d) => d.getName() === name),
  }
}

/**
 * Matches classes that have a decorator whose name matches the regex.
 */
export function haveDecoratorMatching(regex: RegExp): Predicate<ClassDeclaration> {
  return {
    description: `have decorator matching ${String(regex)}`,
    test: (cls) => cls.getDecorators().some((d) => regex.test(d.getName())),
  }
}

/**
 * Matches abstract classes.
 */
export function areAbstract(): Predicate<ClassDeclaration> {
  return {
    description: 'are abstract',
    test: (cls) => cls.isAbstract(),
  }
}

/**
 * Matches classes that have a method with the given name.
 */
export function haveMethodNamed(name: string): Predicate<ClassDeclaration> {
  return {
    description: `have method named "${name}"`,
    test: (cls) => cls.getMethod(name) !== undefined,
  }
}

/**
 * Matches classes that have a method whose name matches the regex.
 */
export function haveMethodMatching(regex: RegExp): Predicate<ClassDeclaration> {
  return {
    description: `have method matching ${String(regex)}`,
    test: (cls) =>
      cls.getMethods().some((m) => {
        const name = m.getName()
        return regex.test(name)
      }),
  }
}

/**
 * Matches classes that have a property with the given name.
 */
export function havePropertyNamed(name: string): Predicate<ClassDeclaration> {
  return {
    description: `have property named "${name}"`,
    test: (cls) => cls.getProperty(name) !== undefined,
  }
}
