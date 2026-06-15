import { useEffect, useState } from 'react';
import type { OrganizationDto } from '@signage/shared';

/** Two-letter initials used as the logo fallback. */
export function orgInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Renders the organization logo as an <img> (never inlined SVG), falling back
 * to initials when there is no logo or the image fails to load. Pass org=null
 * to render the platform/system ("SA") badge used in superadmin context.
 */
export function OrganizationLogo({
  org,
  size = 32,
  className = '',
}: {
  org: Pick<OrganizationDto, 'name' | 'logoUrl'> | null;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [org?.logoUrl]);

  const box = { width: size, height: size };
  if (org?.logoUrl && !broken) {
    return (
      <img
        src={org.logoUrl}
        alt={`${org.name} logo`}
        style={box}
        onError={() => setBroken(true)}
        className={`shrink-0 rounded bg-white object-contain ${className}`}
      />
    );
  }
  return (
    <div
      style={box}
      className={`flex shrink-0 items-center justify-center rounded bg-slate-600 text-xs font-semibold text-slate-100 ${className}`}
      aria-hidden
    >
      {org ? orgInitials(org.name) : 'SA'}
    </div>
  );
}
