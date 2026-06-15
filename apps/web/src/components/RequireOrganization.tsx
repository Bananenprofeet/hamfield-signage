import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

/**
 * Shared "no active organization" panel. Explains the current state and offers
 * the relevant next action, so org-scoped pages never render blank.
 */
export function NoOrganizationState({ what = 'this page' }: { what?: string }) {
  const { isSuperadmin, organizations } = useAuth();

  if (isSuperadmin) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
        <p className="text-sm font-medium text-slate-700">System / Superadmin context</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
          No organization is selected. Select an organization from the switcher to view {what}, or
          use the Superadmin area for platform settings.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Link
            to="/superadmin"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            Go to Superadmin
          </Link>
        </div>
      </div>
    );
  }

  if (organizations.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
        <p className="text-sm font-medium text-slate-700">
          You are not assigned to any organization
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
          Contact a superadmin or an organization admin to be added to an organization.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
      <p className="text-sm font-medium text-slate-700">No organization selected</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
        Choose an organization from the switcher in the sidebar to continue.
      </p>
    </div>
  );
}

/** Guards organization-scoped pages: renders children only when an org is active. */
export function RequireOrganization({ children }: { children: ReactNode }) {
  const { orgId } = useAuth();
  if (!orgId) return <NoOrganizationState />;
  return <>{children}</>;
}
