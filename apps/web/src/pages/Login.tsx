import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ErrorNote, Field, Input } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useAction } from '../lib/hooks';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = useAction(async () => {
    await login(email, password);
    navigate('/devices');
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.run();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-7 shadow-md">
        <h1 className="text-xl font-bold text-slate-900">Signage</h1>
        <p className="mb-5 mt-1 text-sm text-slate-500">Sign in to your dashboard</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <ErrorNote message={submit.error} />
          <Button type="submit" disabled={submit.busy} className="w-full">
            {submit.busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-400">
          Accounts are managed by your administrator.
        </p>
      </div>
    </div>
  );
}
