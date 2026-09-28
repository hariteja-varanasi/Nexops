import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { health as healthApi, incidents as incidentsApi } from '../api/endpoints';
import { Dot } from './ui';

const I = {
  dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z',
  projects: 'M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  apps: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  deployments: 'M12 2l8 4.5v9L12 20l-8-4.5v-9zM12 11l8-4.5M12 11v9M12 11L4 6.5',
  environments: 'M2 7h20M2 12h20M2 17h20',
  infrastructure: 'M4 5h16v5H4zM4 14h16v5H4zM8 7.5h.01M8 16.5h.01',
  monitoring: 'M3 17l5-6 4 4 5-8 4 5',
  logs: 'M5 3h9l5 5v13H5zM14 3v5h5M8 13h8M8 17h6',
  incidents: 'M12 3l9.5 17H2.5zM12 9v5M12 17.5h.01',
  users: 'M16 20v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 7a3.5 3.5 0 107 0 3.5 3.5 0 10-7 0M22 20v-2a4 4 0 00-3-3.8',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1A1.6 1.6 0 007.5 19.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003 14V14a2 2 0 010-4h.1A1.6 1.6 0 004.6 7.5l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0010 3.6V3a2 2 0 014 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7H21a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z',
};

const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

const NAV = [
  { group: 'Deliver', items: [
    { to: '/', label: 'Dashboard', icon: I.dashboard, end: true },
    { to: '/projects', label: 'Projects', icon: I.projects },
    { to: '/applications', label: 'Applications', icon: I.apps },
    { to: '/deployments', label: 'Deployments', icon: I.deployments },
  ]},
  { group: 'Run', items: [
    { to: '/environments', label: 'Environments', icon: I.environments },
    { to: '/infrastructure', label: 'Infrastructure', icon: I.infrastructure },
  ]},
  { group: 'Observe', items: [
    { to: '/monitoring', label: 'Monitoring', icon: I.monitoring },
    { to: '/logs', label: 'Logs', icon: I.logs },
    { to: '/incidents', label: 'Incidents', icon: I.incidents, badge: 'incidents' },
  ]},
  { group: 'Administer', items: [
    { to: '/users', label: 'Users', icon: I.users },
    { to: '/settings', label: 'Settings', icon: I.settings },
  ]},
];

const TITLES = {
  '/': ['Dashboard', 'Platform state at a glance'],
  '/projects': ['Projects', 'Every codebase this platform delivers'],
  '/applications': ['Applications', 'Workloads running across all namespaces'],
  '/deployments': ['Deployments', 'Every pipeline run, newest first'],
  '/environments': ['Environments', 'Namespaces, capacity and health'],
  '/infrastructure': ['Infrastructure', 'The cluster and the toolchain around it'],
  '/monitoring': ['Monitoring', 'Metrics from Prometheus'],
  '/logs': ['Logs', 'Log lines from Loki'],
  '/incidents': ['Incidents', 'What is broken and who is on it'],
  '/users': ['Users', 'Accounts and roles'],
  '/settings': ['Settings', 'How this instance is configured'],
};

export default function Layout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [openIncidents, setOpenIncidents] = useState(0);
  const [clusterHealth, setClusterHealth] = useState(null);
  const [railOpen, setRailOpen] = useState(false);

  useEffect(() => { setRailOpen(false); }, [location.pathname]);

  // Poll health and the open-incident count so the chrome stays live without
  // every page having to fetch it.
  useEffect(() => {
    const load = () => {
      healthApi.get().then(setClusterHealth).catch(() => setClusterHealth({ status: 'DOWN' }));
      incidentsApi.list({ status: 'OPEN' }).then((r) => setOpenIncidents(r.length)).catch(() => {});
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const [title, sub] = TITLES[location.pathname]
    ?? (location.pathname.startsWith('/applications/') ? ['Application', 'Workload detail']
      : location.pathname.startsWith('/deployments/') ? ['Deployment', 'Pipeline run detail']
      : location.pathname.startsWith('/projects/') ? ['Project', 'Project detail']
      : ['NexOps', '']);

  const initials = (user?.full_name || user?.username || '?')
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="shell">
      <aside className={`rail ${railOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">N</span>
          <span className="brand-name">NexOps</span>
          <span className="brand-env mono">kind</span>
        </div>

        <nav className="nav">
          {NAV.map((group) => (
            <div className="nav-group" key={group.group}>
              <div className="nav-group-label">{group.group}</div>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end}
                         className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <Icon d={item.icon} />
                  {item.label}
                  {item.badge === 'incidents' && openIncidents > 0 && (
                    <span className="nav-count alert">{openIncidents}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="rail-foot">
          <div className="who">
            <span className="avatar">{initials}</span>
            <div style={{ minWidth: 0 }}>
              <div className="who-name">{user?.full_name || user?.username}</div>
              <div className="who-role">{user?.role}</div>
            </div>
            <button className="signout" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="btn ghost sm" onClick={() => setRailOpen((v) => !v)}
                  style={{ display: 'none' }} aria-label="Toggle navigation">Menu</button>
          <div>
            <div className="page-title">{title}</div>
            <div className="page-sub">{sub}</div>
          </div>
          <div className="topbar-right">
            <span className="cluster-pill" title="Backend readiness probe">
              <Dot value={clusterHealth?.status} />
              api {clusterHealth?.status?.toLowerCase() ?? '…'}
            </span>
            <span className="cluster-pill" title="PostgreSQL and Redis dependency state">
              <Dot value={clusterHealth?.database} /> pg
              <Dot value={clusterHealth?.redis} /> redis
            </span>
          </div>
        </header>

        <main className="content">
          <Outlet context={{ clusterHealth }} />
        </main>
      </div>
    </div>
  );
}
