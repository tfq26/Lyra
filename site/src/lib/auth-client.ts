import { useState, useEffect, useCallback } from 'react';
import { createAuthClient } from 'better-auth/client';
import { passkeyClient } from '@better-auth/passkey/client';

export const API_BASE_URL = typeof window !== 'undefined' && (window.location.port === '5173' || window.location.hostname === 'localhost')
  ? 'http://localhost:3001'
  : (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001');

export const authClient = createAuthClient({
  baseURL: API_BASE_URL,
  plugins: [
    passkeyClient()
  ]
});

export interface UserSession {
  user: {
    id: string;
    email: string;
    name?: string;
  };
  session: any;
}

// Subscription-based global session cache to keep all components in sync
type SessionListener = (session: UserSession | null) => void;
let cachedSession: UserSession | null = null;
let hasFetchedSession = false;
const listeners = new Set<SessionListener>();

function notifyListeners(s: UserSession | null) {
  cachedSession = s;
  listeners.forEach((fn) => fn(s));
}

export async function fetchCurrentSession(): Promise<UserSession | null> {
  try {
    const res = await authClient.getSession();
    const data = res?.data ? { user: res.data.user as any, session: res.data.session } : null;
    notifyListeners(data);
    hasFetchedSession = true;
    return data;
  } catch {
    notifyListeners(null);
    hasFetchedSession = true;
    return null;
  }
}

/**
 * Clean React hook for reactive Better Auth session state
 * Guaranteed to follow the Rules of Hooks (no try/catch or conditional execution).
 */
export function useSession() {
  const [session, setSession] = useState<UserSession | null>(cachedSession);
  const [isPending, setIsPending] = useState<boolean>(!hasFetchedSession);

  useEffect(() => {
    listeners.add(setSession);
    if (!hasFetchedSession) {
      fetchCurrentSession().finally(() => setIsPending(false));
    } else {
      setIsPending(false);
    }
    return () => {
      listeners.delete(setSession);
    };
  }, []);

  const refetch = useCallback(() => {
    setIsPending(true);
    return fetchCurrentSession().finally(() => setIsPending(false));
  }, []);

  return {
    data: session,
    isPending,
    refetch
  };
}

export async function signInEmail(body: { email: string; password: string }) {
  const res = await authClient.signIn.email(body);
  if (!res.error) {
    await fetchCurrentSession();
  }
  return res;
}

export async function signUpEmail(body: { email: string; password: string; name: string }) {
  const res = await authClient.signUp.email(body);
  if (!res.error) {
    await fetchCurrentSession();
  }
  return res;
}

export async function signOutUser() {
  const res = await authClient.signOut();
  notifyListeners(null);
  return res;
}
