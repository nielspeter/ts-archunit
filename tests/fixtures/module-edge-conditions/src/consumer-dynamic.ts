export async function load(): Promise<unknown> {
  return import('./banned/secret.js')
}
