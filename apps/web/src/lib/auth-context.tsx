'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { login as apiLogin, refresh as apiRefresh, logout as apiLogout, registerAuthHandlers, type ConsentType } from './api';

export interface User {
  id: string;
  email: string;
  name: string;
  lastName?: string | null;
  phone?: string | null;
  role: 'admin' | 'student';
  mustChangePassword: boolean;
  avatarUrl?: string | null;
  questionnaireCompleted?: boolean;
  // Только у студента: недостающие обязательные согласия (пусто/нет = гейт не нужен).
  pendingConsents?: ConsentType[];
}

interface AuthContextValue {
  user: User | null;
  accessToken: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  setAccessToken: (token: string) => void;
  setUser: (user: User) => void;
}

/**
 * Гейт согласий (волна 1.1): студент с недоданными обязательными согласиями
 * должен попасть на /consents. Единая проверка для всех точек маршрутизации
 * (главная, дашборд, логин, смена пароля) — условие не дублируем.
 */
export function needsConsents(
  user: Pick<User, 'role' | 'pendingConsents'> | null,
): boolean {
  return (
    !!user && user.role === 'student' && !!user.pendingConsents && user.pendingConsents.length > 0
  );
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRefresh()
      .then((data) => {
        setUser(data.user);
        setAccessToken(data.accessToken);
      })
      .catch(() => {
        // Not authenticated
      })
      .finally(() => setLoading(false));
  }, []);

  // Авто-обновление access-токена при 401: api-слой дёргает эти колбэки.
  useEffect(() => {
    registerAuthHandlers({
      onToken: (token) => setAccessToken(token),
      onFail: () => {
        setUser(null);
        setAccessToken(null);
      },
    });
    return () => registerAuthHandlers(null);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const data = await apiLogin(email, password);
    setUser(data.user);
    setAccessToken(data.accessToken);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
    setAccessToken(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, accessToken, loading, login, logout, setAccessToken, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
