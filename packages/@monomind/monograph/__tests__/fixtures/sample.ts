import { readFile } from 'fs/promises';

export interface UserService {
  getUser(id: string): Promise<User>;
}

export class UserServiceImpl implements UserService {
  constructor(private db: Database) {}

  async getUser(id: string): Promise<User> {
    return this.db.find(id);
  }
}

function helperFn(x: number): number {
  return x * 2;
}
