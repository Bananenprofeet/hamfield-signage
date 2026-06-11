import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/Login';
import { RegisterPage } from './pages/Register';
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

export function App() {
  const { user, loading } = useAuth();

  if (loading) return <Spinner label="Signing in…" />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/devices" replace />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/devices/:deviceId" element={<DeviceDetailPage />} />
        <Route path="/media" element={<MediaPage />} />
        <Route path="/playlists" element={<PlaylistsPage />} />
        <Route path="/playlists/:playlistId" element={<PlaylistEditorPage />} />
        <Route path="/schedules" element={<SchedulesPage />} />
        <Route path="/schedules/new" element={<ScheduleEditorPage />} />
        <Route path="/schedules/:scheduleId" element={<ScheduleEditorPage />} />
        <Route path="/monitoring" element={<MonitoringPage />} />
        <Route path="/emergency" element={<EmergencyPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/organization" element={<OrgSettingsPage />} />
        <Route path="*" element={<Navigate to="/devices" replace />} />
      </Route>
    </Routes>
  );
}
