// BAD: bare string — the type checker should flag this
export interface UnsafeOptions {
  sortBy?: string
  direction?: 'asc' | 'desc'
}

// GOOD: typed union
export interface SafeOptions {
  sortBy?: 'created_at' | 'updated_at' | 'name'
  direction?: 'asc' | 'desc'
}

// GOOD: via type alias
export type SortColumn = 'created_at' | 'updated_at' | 'price'

export interface AliasedOptions {
  sortBy?: SortColumn
  direction?: 'asc' | 'desc'
}

// Edge case: Partial wrapping a required property
interface StrictOptions {
  sortBy: 'created_at' | 'updated_at'
}
export type PartialStrictOptions = Partial<StrictOptions>

// Edge case: Pick from another interface
export type PickedOptions = Pick<SafeOptions, 'sortBy'>

// Edge case: single string literal (not a union, but not bare string)
export interface SingleLiteralOptions {
  sortBy?: 'created_at'
}

// Edge case: no sortBy property at all
export interface UnrelatedOptions {
  limit?: number
  offset?: number
}

// Edge case: string literal union with undefined explicitly
export interface ExplicitUndefinedOptions {
  sortBy: 'a' | 'b' | undefined
}
