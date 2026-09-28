import axios from 'axios';

// Same-origin by default: NGINX (Ingress in Kubernetes, the frontend container
// in Compose) proxies /api to the backend Service. Only set VITE_API_BASE_URL
// when running the frontend against an API on a different host.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

const TOKEN_KEY = 'nexops.token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// A 401 means the token is gone or expired: clear it and send the operator
// back to sign-in rather than leaving half-loaded pages behind.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config.url.includes('/auth/login')) {
      tokenStore.clear();
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

/** Pulls the human-readable message out of the API's error envelope. */
export function errorMessage(err) {
  const body = err?.response?.data?.error;
  if (body?.details?.length) {
    return body.details.map((d) => `${d.field}: ${d.message}`).join('\n');
  }
  return body?.message || err?.message || 'Something went wrong';
}

export default api;
