import { eagerHelper } from './static-only.js'

export async function run(): Promise<string> {
  // Static import
  const eager = eagerHelper()

  // Dynamic import
  const { lazyHelper } = await import('./target.js')

  return eager + lazyHelper()
}
