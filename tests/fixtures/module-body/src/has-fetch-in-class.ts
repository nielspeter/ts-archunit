// fetch inside a class method (not module scope)
export class ApiClient {
  async getData(): Promise<unknown> {
    return fetch('https://api.example.com/data')
  }
}
