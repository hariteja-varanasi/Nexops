import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import Layout from './components/Layout';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Applications from './pages/Applications';
import ApplicationDetail from './pages/ApplicationDetail';
import Deployments from './pages/Deployments';
import DeploymentDetail from './pages/DeploymentDetail';
import Environments from './pages/Environments';
import Infrastructure from './pages/Infrastructure';
import Monitoring from './pages/Monitoring';
import Logs from './pages/Logs';
import Incidents from './pages/Incidents';
import Users from './pages/Users';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="projects" element={<Projects />} />
            <Route path="applications" element={<Applications />} />
            <Route path="applications/:id" element={<ApplicationDetail />} />
            <Route path="deployments" element={<Deployments />} />
            <Route path="deployments/:id" element={<DeploymentDetail />} />
            <Route path="environments" element={<Environments />} />
            <Route path="infrastructure" element={<Infrastructure />} />
            <Route path="monitoring" element={<Monitoring />} />
            <Route path="logs" element={<Logs />} />
            <Route path="incidents" element={<Incidents />} />
            <Route path="users" element={<Users />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
