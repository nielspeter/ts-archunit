export function addUser(name: string, count: number): { name: string; count: number } {
  return { name, count }
}

export function greet(name: string): string {
  return `Hello, ${name}`
}
