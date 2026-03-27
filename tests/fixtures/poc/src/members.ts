// --- Name checking fixtures (plan 0030) ---

export interface PaginationBad {
  offset: number
  pageSize: number
  filter?: string
}

export interface PaginationGood {
  skip: number
  limit: number
  filter?: string
}

export interface ConfigComplete {
  version: string
  name: string
  debug: boolean
}

export interface ConfigMissingVersion {
  name: string
  debug: boolean
}

// --- Pattern checking fixtures (plan 0030) ---

export interface HasIdField {
  id: string
  name: string
}

export interface MissingIdField {
  name: string
  email: string
}

export interface BadPropertyNames {
  data: unknown
  info: string
  stuff: number[]
}

// --- Readonly fixtures (plan 0030) ---

export interface FullyReadonly {
  readonly id: string
  readonly name: string
}

export interface PartiallyReadonly {
  readonly id: string
  name: string // mutable
}

export interface AllMutable {
  id: string
  name: string
}

// --- Property count fixtures (plan 0030) ---

export interface SmallInterface {
  a: string
  b: number
}

export interface LargeInterface {
  a: string
  b: number
  c: boolean
  d: string
  e: number
  f: boolean
  g: string
  h: number
  i: boolean
  j: string
  k: number
}

// --- Type alias fixtures (plan 0030) ---

export type ReadonlyConfig = Readonly<{
  host: string
  port: number
}>

export type MutableConfig = {
  host: string
  port: number
}

// --- Class fixtures (plan 0030) ---

export class ReadonlyClass {
  readonly id: string = ''
  readonly name: string = ''
}

export class MutableClass {
  id: string = ''
  name: string = ''
}

export class ClassWithForbiddenProp {
  offset: number = 0
  filter: string = ''
}

// --- Stand-in types for DI boundary testing (plan 0031) ---
interface DatabaseClient {
  query(sql: string): void
}
interface Logger {
  log(msg: string): void
}

// --- Classes with typed constructor/method params ---

export class ServiceAcceptingDb {
  constructor(private db: DatabaseClient) {
    void db
  }
}

export class CleanService {
  constructor(private logger: Logger) {
    void logger
  }
}

export class ServiceWithDbMethod {
  connect(db: DatabaseClient): void {
    void db
  }
}

export class RepoAcceptingDb {
  constructor(
    private db: DatabaseClient,
    private logger: Logger,
  ) {
    void db
    void logger
  }
}

/** Class with DatabaseClient in both constructor and method — tests multi-member scanning */
export class ServiceWithDbEverywhere {
  constructor(private db: DatabaseClient) {
    void db
  }
  reconnect(db: DatabaseClient): void {
    void db
  }
}

/** Class with setter accepting DatabaseClient — tests set accessor scanning */
export class ServiceWithDbSetter {
  private _db: DatabaseClient | undefined
  set db(value: DatabaseClient) {
    this._db = value
    void this._db
  }
}

/** Class with setter accepting Logger (no DatabaseClient) — tests setter negative path */
export class ServiceWithLoggerSetter {
  private _logger: Logger | undefined
  set logger(value: Logger) {
    this._logger = value
    void this._logger
  }
}

// --- Visibility fixtures (plan 0032) ---

export class MixedVisibility {
  public getPublicData(): string {
    return ''
  }
  protected loadInternal(): void {}
  private validate(): boolean {
    return true
  }
  noModifier(): string {
    return ''
  }
}

// --- Functions with typed params ---

export function createServiceWithDb(db: DatabaseClient): void {
  void db
}

export function createCleanService(logger: Logger): void {
  void logger
}
