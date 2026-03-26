import type { SourceFile } from 'ts-morph'

/** A named layer resolved to its source files. */
export interface Layer {
  readonly name: string
  readonly pattern: string
  readonly files: SourceFile[]
}

/** A matched pair of elements from two layers. */
export interface LayerPair<A = SourceFile, B = SourceFile> {
  readonly left: A
  readonly leftLayer: string
  readonly right: B
  readonly rightLayer: string
}
