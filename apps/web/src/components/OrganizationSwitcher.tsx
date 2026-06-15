import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { OrganizationLogo } from './OrganizationLogo';

/**
 * Top-of-sidebar control that shows the active organization (logo, name, role)
 * and lets the user switch between their organizations. Superadmins also get a
 * "System / Superadmin context" entry to return to platform context.
 */
export function OrganizationSwitcher() {
  const {
    organizations,
    orgId,
    org,
    switchOrg,
    enterSystemContext,
    isSuperadmin,
    isSystemContext,
  } = useAuth();
  const [open, setOpen] = useState(false);

  const title = isSystemContext ? 'System / Superadmin' : (org?.name ?? 'No organization selected');
  const subtitle = isSystemContext
    ? 'Platform context'
    : org?.role
      ? `Current organization · ${org.role}`
      : 'Select an organization to continue';

  return (
    <div className="relative px-3 pb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-left hover:bg-slate-700"
      >
        <OrganizationLogo org={isSystemContext ? null : org} size={28} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">{title}</span>
          <span className="block truncate text-xs text-slate-400">{subtitle}</span>
        </span>
        <span aria-hidden className="text-slate-400">
          ▾
        </span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="listbox"
            className="absolute inset-x-3 z-20 mt-1 max-h-80 overflow-auto rounded-md border border-slate-700 bg-slate-800 py-1 shadow-xl"
          >
            <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Switch organization
            </div>
            {organizations.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">No organizations available</div>
            ) : null}
            {organizations.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={o.id === orgId}
                onClick={() => {
                  switchOrg(o.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-700"
              >
                <OrganizationLogo org={o} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-100">{o.name}</span>
                  <span className="block truncate text-xs text-slate-400">
                    {o.role ?? 'member'}
                    {o.status === 'disabled' ? ' · disabled' : ''}
                  </span>
                </span>
                {o.id === orgId ? <span className="text-blue-400">✓</span> : null}
              </button>
            ))}

            {isSuperadmin ? (
              <>
                <div className="my-1 border-t border-slate-700" />
                <button
                  type="button"
                  role="option"
                  aria-selected={isSystemContext}
                  onClick={() => {
                    enterSystemContext();
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-700"
                >
                  <OrganizationLogo org={null} size={24} />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-100">
                    System / Superadmin context
                  </span>
                  {isSystemContext ? <span className="text-blue-400">✓</span> : null}
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
