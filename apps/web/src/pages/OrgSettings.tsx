import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { OrganizationDto, OrganizationMemberDto } from '@signage/shared';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Td,
  Th,
} from '../components/ui';
import { api } from '../lib/api';
import { useAuth, useOrgId } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { useAction, useApi } from '../lib/hooks';

const ASSIGNABLE_ROLES = ['viewer', 'editor', 'admin'] as const;

export function OrgSettingsPage() {
  const orgId = useOrgId();
  const { user, refreshOrgs } = useAuth();
  const org = useApi(() => api.get<OrganizationDto>(`/orgs/${orgId}`), [orgId]);
  const members = useApi(() => api.get<OrganizationMemberDto[]>(`/orgs/${orgId}/members`), [orgId]);

  const [name, setName] = useState('');
  useEffect(() => {
    if (org.data) setName(org.data.name);
  }, [org.data]);

  const rename = useAction(async () => {
    await api.patch(`/orgs/${orgId}`, { name });
    await refreshOrgs();
    org.reload();
  });

  const changeRole = useAction(async (member: OrganizationMemberDto, role: string) => {
    await api.patch(`/orgs/${orgId}/members/${member.id}`, { role });
    members.reload();
  });

  const removeMember = useAction(async (member: OrganizationMemberDto) => {
    if (!window.confirm(`Remove ${member.email} from this organization?`)) return;
    await api.delete(`/orgs/${orgId}/members/${member.id}`);
    members.reload();
  });

  return (
    <div>
      <PageHeader
        title="Organization settings"
        subtitle={org.data?.name ?? ''}
        actions={
          <Link to="/settings" className="text-sm font-medium text-blue-600 hover:underline">
            ← Back to settings
          </Link>
        }
      />

      <div className="space-y-4">
        <Card title="Organization">
          <ErrorNote message={org.error ?? rename.error} />
          <div className="flex max-w-md items-end gap-2">
            <div className="flex-1">
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
            </div>
            <Button
              onClick={() => rename.run()}
              disabled={rename.busy || !name.trim() || name === org.data?.name}
            >
              {rename.busy ? 'Saving…' : 'Rename'}
            </Button>
          </div>
          {org.data ? <p className="mt-2 text-xs text-slate-500">Slug: {org.data.slug}</p> : null}
        </Card>

        <Card title="Members">
          <ErrorNote message={members.error ?? changeRole.error ?? removeMember.error} />
          {members.loading && !members.data ? <Spinner /> : null}
          {members.data ? (
            <div className="overflow-hidden rounded-md border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th>Role</Th>
                    <Th>Member since</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {members.data.map((member) => {
                    const isSelf = member.userId === user?.id;
                    return (
                      <tr key={member.id}>
                        <Td>
                          <span className="font-medium text-slate-900">{member.name}</span>
                          {isSelf ? (
                            <span className="ml-1.5 text-xs text-slate-400">(you)</span>
                          ) : null}
                        </Td>
                        <Td>{member.email}</Td>
                        <Td>
                          {member.role === 'owner' ? (
                            <Badge tone="blue">owner</Badge>
                          ) : (
                            <div className="w-28">
                              <Select
                                value={member.role}
                                disabled={changeRole.busy}
                                onChange={(e) => changeRole.run(member, e.target.value)}
                              >
                                {ASSIGNABLE_ROLES.map((role) => (
                                  <option key={role} value={role}>
                                    {role}
                                  </option>
                                ))}
                              </Select>
                            </div>
                          )}
                        </Td>
                        <Td>{formatDateTime(member.createdAt)}</Td>
                        <Td>
                          {member.role !== 'owner' && !isSelf ? (
                            <Button
                              variant="ghost"
                              small
                              onClick={() => removeMember.run(member)}
                              disabled={removeMember.busy}
                            >
                              Remove
                            </Button>
                          ) : null}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="mt-4 border-t border-slate-100 pt-4">
            <AddMemberForm orgId={orgId} onAdded={members.reload} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function AddMemberForm({ orgId, onAdded }: { orgId: string; onAdded: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('viewer');

  const add = useAction(async () => {
    await api.post(`/orgs/${orgId}/members`, { email: email.trim(), role });
    setEmail('');
    onAdded();
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    add.run();
  };

  return (
    <form onSubmit={onSubmit}>
      <p className="mb-2 text-sm font-medium text-slate-700">Add a member</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-72">
          <Input
            type="email"
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="w-32">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={add.busy}>
          {add.busy ? 'Adding…' : 'Add member'}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        The person must already have an account — a superadmin can create one.
      </p>
      <ErrorNote message={add.error} />
    </form>
  );
}
