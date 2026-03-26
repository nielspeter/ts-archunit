// Optional chaining calls
declare const app: {
  get?(path: string, handler: Function): void
}

app?.get?.('/api/safe', (req: unknown, res: unknown) => {
  // route with optional chaining
})
