import { useEffect, useRef, useState } from 'react';

export type User = {
  id: string;
  name: string;
  email: string;
};

type Props = {
  search: (query: string) => Promise<User[]>;
  onSelect?: (user: User) => void;
  /** How long to wait after the last keystroke before searching */
  debounceMs?: number;
};

type State = { type: 'idle' } | { type: 'loading' } | { type: 'done'; users: User[] } | { type: 'error' };

export const UserSearch = ({ search, onSelect, debounceMs = 250 }: Props) => {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ type: 'idle' });
  const [selected, setSelected] = useState<User>();
  const [attempt, setAttempt] = useState(0);
  // Only the answer to the latest request is shown, even if an earlier one arrives later
  const latestRequest = useRef(0);

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) {
      latestRequest.current++;
      setState({ type: 'idle' });
      return;
    }
    const timer = setTimeout(() => {
      const request = ++latestRequest.current;
      setState({ type: 'loading' });
      search(trimmed).then(
        users => request === latestRequest.current && setState({ type: 'done', users }),
        () => request === latestRequest.current && setState({ type: 'error' }),
      );
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [trimmed, attempt, search, debounceMs]);

  const select = (user: User) => {
    setSelected(user);
    setQuery('');
    onSelect?.(user);
  };

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 360 }}>
      <input
        type="search"
        aria-label="Search users"
        placeholder="Type at least two letters"
        value={query}
        onChange={event => setQuery(event.target.value)}
      />

      {state.type === 'loading' && (
        <div role="progressbar" aria-label="Loading users" style={{ color: '#6e7781' }}>
          Searching…
        </div>
      )}

      {state.type === 'error' && (
        <div role="alert" style={{ color: 'crimson', display: 'flex', gap: 8, alignItems: 'center' }}>
          Could not load users.
          <button type="button" onClick={() => setAttempt(current => current + 1)}>
            Try again
          </button>
        </div>
      )}

      {state.type === 'done' &&
        (state.users.length === 0 ? (
          <p style={{ margin: 0 }}>No users match “{trimmed}”</p>
        ) : (
          <ul aria-label="Results" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4 }}>
            {state.users.map(user => (
              <li key={user.id}>
                <button type="button" onClick={() => select(user)} style={{ width: '100%', textAlign: 'left' }}>
                  <strong>{user.name}</strong> <span style={{ color: '#6e7781' }}>{user.email}</span>
                </button>
              </li>
            ))}
          </ul>
        ))}

      {selected && <p style={{ margin: 0 }}>Selected: {selected.name}</p>}
    </div>
  );
};
