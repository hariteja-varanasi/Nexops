import api from './client';

const unwrap = (p) => p.then((r) => r.data);
const qs = (params) => {
  const clean = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== '' && v != null)
  );
  const s = new URLSearchParams(clean).toString();
  return s ? `?${s}` : '';
};

export const auth = {
  login: (username, password) => unwrap(api.post('/api/auth/login', { username, password })),
  me: () => unwrap(api.get('/api/auth/me')),
};

export const dashboard = {
  stats: () => unwrap(api.get('/api/dashboard/stats')),
};

export const projects = {
  list: (f) => unwrap(api.get(`/api/projects${qs(f)}`)),
  get: (id) => unwrap(api.get(`/api/projects/${id}`)),
  create: (b) => unwrap(api.post('/api/projects', b)),
  update: (id, b) => unwrap(api.put(`/api/projects/${id}`, b)),
  remove: (id) => unwrap(api.delete(`/api/projects/${id}`)),
};

export const applications = {
  list: (f) => unwrap(api.get(`/api/applications${qs(f)}`)),
  get: (id) => unwrap(api.get(`/api/applications/${id}`)),
  create: (b) => unwrap(api.post('/api/applications', b)),
  update: (id, b) => unwrap(api.put(`/api/applications/${id}`, b)),
  remove: (id) => unwrap(api.delete(`/api/applications/${id}`)),
  scale: (id, replicas) => unwrap(api.post(`/api/applications/${id}/scale`, { replicas })),
  restart: (id) => unwrap(api.post(`/api/applications/${id}/restart`)),
  rollback: (id) => unwrap(api.post(`/api/applications/${id}/rollback`)),
};

export const deployments = {
  list: (f) => unwrap(api.get(`/api/deployments${qs(f)}`)),
  get: (id) => unwrap(api.get(`/api/deployments/${id}`)),
  create: (b) => unwrap(api.post('/api/deployments', b)),
  stages: () => unwrap(api.get('/api/deployments/pipeline-stages')),
  complete: (id, status) => unwrap(api.put(`/api/deployments/${id}/complete`, { status })),
};

export const environments = {
  list: () => unwrap(api.get('/api/environments')),
  get: (slug) => unwrap(api.get(`/api/environments/${slug}`)),
};

export const incidents = {
  list: (f) => unwrap(api.get(`/api/incidents${qs(f)}`)),
  create: (b) => unwrap(api.post('/api/incidents', b)),
  update: (id, b) => unwrap(api.put(`/api/incidents/${id}`, b)),
};

export const monitoring = {
  overview: (hours = 6) => unwrap(api.get(`/api/monitoring/overview?hours=${hours}`)),
};

export const logs = {
  query: (f) => unwrap(api.get(`/api/logs${qs(f)}`)),
  facets: () => unwrap(api.get('/api/logs/facets')),
};

export const users = {
  list: () => unwrap(api.get('/api/users')),
  create: (b) => unwrap(api.post('/api/users', b)),
  update: (id, b) => unwrap(api.put(`/api/users/${id}`, b)),
  remove: (id) => unwrap(api.delete(`/api/users/${id}`)),
};

export const health = {
  get: () => unwrap(api.get('/api/health')),
};

export const activity = {
  list: (limit = 25) => unwrap(api.get(`/api/activity?limit=${limit}`)),
};
