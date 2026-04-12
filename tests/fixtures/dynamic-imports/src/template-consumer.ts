/** Consumes target.ts and template-only-target.ts via template literal dynamic imports. */
export async function runTemplate(): Promise<string> {
  const { lazyHelper } = await import(`./target.js`)
  const { templateOnlyHelper } = await import(`./template-only-target.js`)
  return lazyHelper() + templateOnlyHelper()
}
