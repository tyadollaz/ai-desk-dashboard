import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api';

export default function Login() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      setPassword('');
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('Incorrect password.');
      else if (err instanceof ApiError && err.status === 429) {
        const s = err.retryAfterSec;
        setError(
          s
            ? `Too many attempts. Try again in ${s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`}.`
            : 'Too many attempts. Please wait a while and try again.',
        );
      } else setError('Could not sign in. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form onSubmit={submit} className="login-card">
        <h1>AI Desk Dashboard</h1>
        <label htmlFor="pw">Password</label>
        <input
          id="pw"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={busy || password === ''}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
