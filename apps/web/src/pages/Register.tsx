import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, ErrorNote, Field, Input } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useAction } from '../lib/hooks';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = useAction(async () => {
    await register({ email, password, name, organizationName });
    navigate('/devices');
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit.run();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-7 shadow-md">
        <h1 className="text-xl font-bold text-slate-900">Create your account</h1>
        <p className="mb-5 mt-1 text-sm text-slate-500">
          Set up a new organization to manage your screens
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Your name">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Organization name">
            <Input
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              required
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Password" hint="At least 8 characters">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </Field>
          <ErrorNote message={submit.error} />
          <Button type="submit" disabled={submit.busy} className="w-full">
            {submit.busy ? 'Creating…' : 'Create account'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-500">
          Already registered?{' '}
          <Link to="/login" className="font-medium text-blue-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
