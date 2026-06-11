import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const NAV_ITEMS = [
  { to: '/devices', label: 'Screens', icon: '🖥' },
  { to: '/monitoring', label: 'Monitoring', icon: '📈' },
  { to: '/media', label: 'Media', icon: '🖼' },
  { to: '/playlists', label: 'Playlists', icon: '🎞' },
  { to: '/schedules', label: 'Schedules', icon: '🗓' },
  { to: '/emergency', label: 'Emergency', icon: '🚨' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

export function Layout() {
  const { user, organizations, orgId, switchOrg, logout } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col bg-slate-900 text-slate-200">
        <div className="px-4 py-5">
          <div className="text-lg font-bold text-white">Signage</div>
          <div className="text-xs text-slate-400">Digital signage console</div>
        </div>

        {organizations.length > 0 ? (
          <div className="px-3 pb-3">
            <select
              value={orgId ?? ''}
              onChange={(e) => switchOrg(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <nav className="flex-1 space-y-0.5 px-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60'
                }`
              }
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
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
        <Outlet />
      </main>
    </div>
  );
}
