import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { auth as authApi } from '../api/endpoints';
import { tokenStore } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On load, a token in storage is only a claim. Verify it against the API so
  // an expired token does not render a signed-in shell that 401s on every call.
  useEffect(() => {
    if (!tokenStore.get()) { setLoading(false); return; }
    authApi.me()
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    async signIn(username, password) {
      const res = await authApi.login(username, password);
      tokenStore.set(res.token);
      const me = await authApi.me();
      setUser(me);
      return me;
    },
    signOut() {
      tokenStore.clear();
      setUser(null);
    },
    can(...roles) {
      if (!user) return false;
      return user.role === 'ADMIN' || roles.includes(user.role);
    },
  }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
