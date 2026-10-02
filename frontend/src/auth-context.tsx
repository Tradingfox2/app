import React, { createContext, useContext, useEffect, useState } from "react";
import { router } from "expo-router";
import { api, auth, User } from "./api";
import { cancelMissedSessionNote } from "./missed-session-note";
import { unregisterPush, usePushNotifications } from "./push";

type Ctx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, role: string, referralCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const t = await auth.getToken();
      if (t) {
        try {
          const me = await api.me();
          setUser(me);
        } catch {
          await auth.clearToken();
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const r = await api.login(email, password);
    await auth.setToken(r.access_token);
    setUser(r.user);
  };
  const register = async (email: string, password: string, name: string, role: string, referralCode?: string) => {
    const r = await api.register(email, password, name, role, referralCode);
    await auth.setToken(r.access_token);
    setUser(r.user);
  };
  usePushNotifications(!!user);
  const logout = async () => {
    try {
      await cancelMissedSessionNote();
      await unregisterPush(); // needs the token, so before clearing it
      await auth.clearToken();
    } finally {
      setUser(null);
      router.replace("/auth");
    }
  };
  const refresh = async () => {
    try {
      setUser(await api.me());
    } catch {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
