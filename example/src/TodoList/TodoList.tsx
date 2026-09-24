import { type FormEvent, useState } from 'react';

export type Todo = {
  id: number;
  title: string;
  done: boolean;
};

const FILTERS = {
  All: () => true,
  Active: (todo: Todo) => !todo.done,
  Done: (todo: Todo) => todo.done,
};

type Filter = keyof typeof FILTERS;

type Props = {
  initialTodos?: Todo[];
  onChange?: (todos: Todo[]) => void;
};

export const TodoList = ({ initialTodos = [], onChange }: Props) => {
  const [todos, setTodos] = useState(initialTodos);
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState<Filter>('All');

  const update = (next: Todo[]) => {
    setTodos(next);
    onChange?.(next);
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    update([...todos, { id: Math.max(0, ...todos.map(todo => todo.id)) + 1, title: title.trim(), done: false }]);
    setTitle('');
  };

  const visible = todos.filter(FILTERS[filter]);
  const left = todos.filter(todo => !todo.done).length;

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 360 }}>
      <form onSubmit={add} style={{ display: 'flex', gap: 8 }}>
        <input
          aria-label="New todo"
          placeholder="What needs doing?"
          value={title}
          onChange={event => setTitle(event.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit">Add</button>
      </form>

      <div role="group" aria-label="Filter" style={{ display: 'flex', gap: 4 }}>
        {(Object.keys(FILTERS) as Filter[]).map(name => (
          <button
            key={name}
            type="button"
            aria-pressed={filter === name}
            onClick={() => setFilter(name)}
            style={{ fontWeight: filter === name ? 'bold' : 'normal' }}
          >
            {name}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p style={{ color: '#6e7781', margin: 0 }}>Nothing to do</p>
      ) : (
        <ul aria-label="Todos" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4 }}>
          {visible.map(todo => (
            <li key={todo.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ flex: 1, textDecoration: todo.done ? 'line-through' : 'none' }}>
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => update(todos.map(t => (t.id === todo.id ? { ...t, done: !t.done } : t)))}
                />{' '}
                {todo.title}
              </label>
              <button
                type="button"
                aria-label={`Delete ${todo.title}`}
                onClick={() => update(todos.filter(t => t.id !== todo.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span role="status">
          {left} {left === 1 ? 'item' : 'items'} left
        </span>
        {todos.some(todo => todo.done) && (
          <button type="button" onClick={() => update(todos.filter(todo => !todo.done))}>
            Clear completed
          </button>
        )}
      </footer>
    </div>
  );
};
