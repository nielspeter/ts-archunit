export class BaseRepository {
  protected tableName: string

  constructor(tableName: string) {
    this.tableName = tableName
  }
}
