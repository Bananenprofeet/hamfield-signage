import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { OrganizationSwitcher } from './OrganizationSwitcher';
import { ErrorBoundary } from './ErrorBoundary';

const ORG_NAV_ITEMS = [
  { to: '/devices', label: 'Screens', icon: '🖥' },
  { to: '/monitoring', label: 'Monitoring', icon: '📈' },
  { to: '/media', label: 'Media', icon: '🖼' },
  { to: '/playlists', label: 'Playlists', icon: '🎞' },
  { to: '/schedules', label: 'Schedules', icon: '🗓' },
  { to: '/emergency', label: 'Emergency', icon: '🚨' },
];

const navClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60'
  }`;

export function Layout() {
  const { user, orgId, isSystemContext, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-slate-200">
        <div className="px-4 py-4">
          <div className="text-lg font-bold text-white">Signage</div>
          <div className="text-xs text-slate-400">Digital signage console</div>
        </div>

        <OrganizationSwitcher />

        {isSystemContext ? (
          <div className="mx-3 mb-2 rounded-md border border-amber-700/40 bg-amber-900/20 px-2.5 py-2 text-xs text-amber-200">
            You are in <span className="font-semibold">System / Superadmin</span> context. Select an
            organization to manage its screens and media.
          </div>
        ) : null}

        <nav className="flex-1 space-y-0.5 px-2">
          {/* Org-scoped navigation is hidden in superadmin system context. */}
          {!isSystemContext
            ? ORG_NAV_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} className={navClass}>
                  <span aria-hidden>{item.icon}</span>
                  {item.label}
                </NavLink>
              ))
            : null}

          <NavLink to="/settings" className={navClass}>
            <span aria-hidden>⚙️</span>
            Settings
          </NavLink>

          {user?.globalRole === 'superadmin' ? (
            <>
              <div className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Superadmin
              </div>
              <NavLink to="/superadmin" end className={navClass}>
                <span aria-hidden>🏢</span>
                Companies
              </NavLink>
              <NavLink to="/superadmin/users" className={navClass}>
                <span aria-hidden>👥</span>
                Users
              </NavLink>
            </>
          ) : null}
        </nav>

        <div className="border-t border-slate-800 px-4 py-3">
          <div className="truncate text-sm text-slate-300">{user?.name}</div>
          <div className="truncate text-xs text-slate-500">{user?.email}</div>
          <button
            onClick={logout}
            className="mt-2 text-xs font-medium text-slate-400 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-6">
        {/* Remount on org switch / navigation: clears stale data and any error. */}
        <ErrorBoundary resetKey={`${orgId ?? 'system'}:${location.pathname}`}>
          <div key={orgId ?? 'system'}>
            <Outlet />
          </div>
        </ErrorBoundary>
      </main>
    </div>
  );
}
