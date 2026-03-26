// Fixture for testing decorator and implements predicates
export interface Serializable {
  serialize(): string
}

export interface Loggable {
  log(): void
}

export function Controller(_target: Function) {}
export function Injectable(_target: Function) {}

@Controller
export class UserController implements Serializable {
  serialize(): string {
    return 'user'
  }
}

@Injectable
export class UserRepository implements Serializable, Loggable {
  serialize(): string {
    return 'repo'
  }
  log(): void {}
}

export class PlainClass {
  doSomething(): void {}
}
