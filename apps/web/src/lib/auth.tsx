import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthResponse, OrganizationDto, UserDto } from '@signage/shared';
import { api, hasToken, setToken } from './api';

const ORG_KEY = 'signage.orgId';

interface AuthContextValue {
  user: UserDto | null;
  organizations: OrganizationDto[];
  orgId: string | null;
  org: OrganizationDto | null;
  loading: boolean;
  /** True for platform superadmins (User.globalRole === 'superadmin'). */
  isSuperadmin: boolean;
  /** True when a superadmin is acting without an active organization. */
  isSystemContext: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  switchOrg: (orgId: string) => void;
  /** Clears the active organization (returns a superadmin to system context). */
  enterSystemContext: () => void;
  refreshOrgs: () => Promise<void>;
  /** Re-fetches /auth/me, e.g. after a forced password change. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationDto[]>([]);
  const [orgId, setOrgId] = useState<string | null>(localStorage.getItem(ORG_KEY));
  const [loading, setLoading] = useState(hasToken());

  const apply = useCallback((response: { user: UserDto; organizations: OrganizationDto[] }) => {
    setUser(response.user);
    setOrganizations(response.organizations);
    setOrgId((current) => {
      const valid = current != null && response.organizations.some((o) => o.id === current);
      // Superadmins default to system context; regular users auto-select their
      // (single or first) organization so they land on real data immediately.
      const next = valid
        ? current
        : response.user.globalRole === 'superadmin'
          ? null
          : (response.organizations[0]?.id ?? null);
      if (next) localStorage.setItem(ORG_KEY, next);
      else localStorage.removeItem(ORG_KEY);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!hasToken()) return;
    api
      .get<{ user: UserDto; organizations: OrganizationDto[] }>('/auth/me')
      .then(apply)
      .catch(() => {
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [apply]);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await api.post<AuthResponse>('/auth/login', { email, password });
      setToken(response.token);
      apply(response);
    },
    [apply],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setOrganizations([]);
  }, []);

  const switchOrg = useCallback((id: string) => {
    localStorage.setItem(ORG_KEY, id);
    setOrgId(id);
  }, []);

  const enterSystemContext = useCallback(() => {
    localStorage.removeItem(ORG_KEY);
    setOrgId(null);
  }, []);

  const refreshOrgs = useCallback(async () => {
    const orgs = await api.get<OrganizationDto[]>('/orgs');
    setOrganizations(orgs);
  }, []);

  const refreshUser = useCallback(async () => {
    const response = await api.get<{ user: UserDto; organizations: OrganizationDto[] }>('/auth/me');
    apply(response);
  }, [apply]);

  const isSuperadmin = user?.globalRole === 'superadmin';
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      organizations,
      orgId,
      org: organizations.find((o) => o.id === orgId) ?? null,
      loading,
      isSuperadmin,
      isSystemContext: isSuperadmin && !orgId,
      login,
      logout,
      switchOrg,
      enterSystemContext,
      refreshOrgs,
      refreshUser,
    }),
    [
      user,
      organizations,
      orgId,
      loading,
      isSuperadmin,
      login,
      logout,
      switchOrg,
      enterSystemContext,
      refreshOrgs,
      refreshUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Convenience for org-scoped pages where orgId is guaranteed by the router. */
export function useOrgId(): string {
  const { orgId } = useAuth();
  if (!orgId) throw new Error('No organization selected');
  return orgId;
}
