import { type FormEvent, useState } from 'react';

export type Credentials = {
  username: string;
  password: string;
};

type Props = {
  onSubmit: (credentials: Credentials) => void;
  initialValues?: Partial<Credentials>;
};

export const LoginForm = ({ onSubmit, initialValues }: Props) => {
  const [username, setUsername] = useState(initialValues?.username ?? '');
  const [password, setPassword] = useState(initialValues?.password ?? '');
  const [errors, setErrors] = useState<string[]>([]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = [
      ...(username.trim() ? [] : ['Username is required']),
      ...(password.length >= 8 ? [] : ['The password needs at least 8 characters']),
    ];
    setErrors(nextErrors);
    if (nextErrors.length === 0) {
      onSubmit({ username, password });
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 8, maxWidth: 280 }}>
      <label>
        Username
        <input value={username} onChange={event => setUsername(event.target.value)} style={{ display: 'block' }} />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          style={{ display: 'block' }}
        />
      </label>
      {errors.length > 0 && (
        <ul role="alert" style={{ color: 'crimson', margin: 0 }}>
          {errors.map(error => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <button type="submit">Log in</button>
    </form>
  );
};
