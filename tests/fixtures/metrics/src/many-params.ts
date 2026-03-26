// Class with methods that have many parameters.

export class ParamHeavy {
  // 8 parameters — should violate maxParameters(4)
  create(
    name: string,
    email: string,
    age: number,
    role: string,
    active: boolean,
    department: string,
    manager: string,
    location: string,
  ): void {
    void [name, email, age, role, active, department, manager, location]
  }

  // 2 parameters — should pass
  update(id: string, data: Record<string, unknown>): void {
    void [id, data]
  }

  // Constructor with 6 parameters — should violate maxParameters(4)
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly email: string,
    public readonly age: number,
    public readonly role: string,
    public readonly active: boolean,
  ) {}
}
