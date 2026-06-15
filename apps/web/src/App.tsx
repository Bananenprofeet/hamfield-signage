import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';
import { RequireOrganization } from './components/RequireOrganization';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/Login';
import { ChangePasswordPage } from './pages/ChangePassword';
import { DevicesPage } from './pages/Devices';
import { DeviceDetailPage } from './pages/DeviceDetail';
import { MediaPage } from './pages/Media';
import { PlaylistsPage } from './pages/Playlists';
import { PlaylistEditorPage } from './pages/PlaylistEditor';
import { SchedulesPage } from './pages/Schedules';
import { ScheduleEditorPage } from './pages/ScheduleEditor';
import { MonitoringPage } from './pages/Monitoring';
import { EmergencyPage } from './pages/Emergency';
import { SettingsPage } from './pages/Settings';
import { OrgSettingsPage } from './pages/OrgSettings';
import { SuperadminOrgsPage } from './pages/SuperadminOrgs';
import { SuperadminUsersPage } from './pages/SuperadminUsers';

/** Org-scoped pages need a selected organization (superadmins may have none). */
function OrgRoute({ children }: { children: ReactNode }) {
  return <RequireOrganization>{children}</RequireOrganization>;
}

function SuperadminRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.globalRole !== 'superadmin') return <Navigate to="/devices" replace />;
  return <>{children}</>;
}

export function App() {
  const { user, loading } = useAuth();

  if (loading) return <Spinner label="Signing in…" />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // Accounts created with a temporary password must set their own first.
  if (user.mustChangePassword) {
    return <ChangePasswordPage forced />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/devices" replace />} />
        <Route
          path="/devices"
          element={
            <OrgRoute>
              <DevicesPage />
            </OrgRoute>
          }
        />
        <Route
          path="/devices/:deviceId"
          element={
            <OrgRoute>
              <DeviceDetailPage />
            </OrgRoute>
          }
        />
        <Route
          path="/media"
          element={
            <OrgRoute>
              <MediaPage />
            </OrgRoute>
          }
        />
        <Route
          path="/playlists"
          element={
            <OrgRoute>
              <PlaylistsPage />
            </OrgRoute>
          }
        />
        <Route
          path="/playlists/:playlistId"
          element={
            <OrgRoute>
              <PlaylistEditorPage />
            </OrgRoute>
          }
        />
        <Route
          path="/schedules"
          element={
            <OrgRoute>
              <SchedulesPage />
            </OrgRoute>
          }
        />
        <Route
          path="/schedules/new"
          element={
            <OrgRoute>
              <ScheduleEditorPage />
            </OrgRoute>
          }
        />
        <Route
          path="/schedules/:scheduleId"
          element={
            <OrgRoute>
              <ScheduleEditorPage />
            </OrgRoute>
          }
        />
        <Route
          path="/monitoring"
          element={
            <OrgRoute>
              <MonitoringPage />
            </OrgRoute>
          }
        />
        <Route
          path="/emergency"
          element={
            <OrgRoute>
              <EmergencyPage />
            </OrgRoute>
          }
        />
        <Route path="/settings" element={<SettingsPage />} />
        <Route
          path="/settings/organization"
          element={
            <OrgRoute>
              <OrgSettingsPage />
            </OrgRoute>
          }
        />
        <Route
          path="/superadmin"
          element={
            <SuperadminRoute>
              <SuperadminOrgsPage />
            </SuperadminRoute>
          }
        />
        <Route
          path="/superadmin/users"
          element={
            <SuperadminRoute>
              <SuperadminUsersPage />
            </SuperadminRoute>
          }
        />
        <Route path="*" element={<Navigate to="/devices" replace />} />
      </Route>
    </Routes>
  );
}
