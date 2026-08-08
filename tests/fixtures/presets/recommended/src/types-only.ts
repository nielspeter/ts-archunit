// A file the `recommended` preset's globs MATCH but whose subjects are zero:
// it declares no functions. That distinguishes a live-glob-empty-selection
// (declarable with expectEmpty) from a dead glob (a config error that is not).
export interface Account {
  id: string
  balance: number
}

export type AccountId = Account['id']
