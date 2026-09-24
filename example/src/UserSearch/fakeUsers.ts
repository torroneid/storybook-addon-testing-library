import type { User } from './UserSearch';

export const USERS: User[] = [
  { id: 'ada', name: 'Ada Lovelace', email: 'ada@example.com' },
  { id: 'grace', name: 'Grace Hopper', email: 'grace@example.com' },
  { id: 'alan', name: 'Alan Turing', email: 'alan@example.com' },
  { id: 'margaret', name: 'Margaret Hamilton', email: 'margaret@example.com' },
  { id: 'linus', name: 'Linus Torvalds', email: 'linus@example.com' },
];

/** A search that answers after `delay` ms, like a slow API */
export const createFakeSearch =
  ({ delay = 300, fail = false }: { delay?: number; fail?: boolean } = {}) =>
  (query: string) =>
    new Promise<User[]>((resolve, reject) =>
      setTimeout(() => {
        if (fail) {
          reject(new Error('The server is down'));
        } else {
          const needle = query.toLowerCase();
          resolve(USERS.filter(user => `${user.name} ${user.email}`.toLowerCase().includes(needle)));
        }
      }, delay),
    );
