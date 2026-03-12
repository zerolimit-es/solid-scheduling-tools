/**
 * @zerolimit/solid-auth/react — useAuth Hook
 *
 * React hook that manages Solid OIDC authentication state.
 * Communicates with the backend via HTTP API — no direct Solid
 * library dependency in the browser.
 */

import { useState, useEffect, useCallback } from 'react';

const DEFAULT_FALLBACK_PROVIDERS = [
  { name: 'Inrupt PodSpaces', url: 'https://login.inrupt.com' },
  { name: 'solidcommunity.net', url: 'https://solidcommunity.net' },
  { name: 'solidweb.org', url: 'https://solidweb.org' },
  { name: 'solidweb.me', url: 'https://solidweb.me' },
];

/**
 * @param {import('../core/types.js').UseAuthConfig} [config]
 */
export function useAuth(config = {}) {
  const {
    apiBase = '',
    defaultProvider = 'https://login.inrupt.com',
    fallbackProviders = DEFAULT_FALLBACK_PROVIDERS,
  } = config;

  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [mfaPending, setMfaPending] = useState(false);
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState(defaultProvider);

  // Helper: fetch with credentials
  const apiFetch = useCallback(async (endpoint, options = {}) => {
    const res = await fetch(`${apiBase}${endpoint}`, {
      ...options,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || 'Request failed');
    return data;
  }, [apiBase]);

  // Check auth status on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const status = await apiFetch('/api/auth/status');
        if (status.isLoggedIn) {
          setUser({ webId: status.webId, pods: status.pods || [] });
          setMfaPending(!!status.mfaPending);
        }
      } catch (err) {
        // Not authenticated — that's fine
      } finally {
        setAuthLoading(false);
      }
    };

    // Clean up ?login query param from OIDC redirect
    const params = new URLSearchParams(window.location.search);
    if (params.has('login')) {
      window.history.replaceState({}, '', window.location.pathname);
    }

    checkAuth();
  }, [apiFetch]);

  // Fetch providers on mount
  useEffect(() => {
    apiFetch('/api/auth/providers')
      .then(data => setProviders(data.providers || []))
      .catch(() => setProviders(fallbackProviders));
  }, [apiFetch, fallbackProviders]);

  // Initiate login
  const handleLogin = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedProvider) params.set('oidcIssuer', selectedProvider);
    params.set('returnTo', window.location.origin);
    window.location.href = `${apiBase}/api/auth/login?${params}`;
  }, [apiBase, selectedProvider]);

  // Handle MFA success
  const handleMfaSuccess = useCallback(async () => {
    setMfaPending(false);
    try {
      const status = await apiFetch('/api/auth/status');
      if (status.isLoggedIn) {
        setUser({ webId: status.webId, pods: status.pods || [] });
      }
    } catch {}
  }, [apiFetch]);

  // Logout
  const logout = useCallback(async () => {
    setLoggingOut(true);
    try {
      const res = await apiFetch('/api/auth/logout', { method: 'POST' });
      if (res.endSessionUrl) {
        setUser(null);
        setMfaPending(false);
        // Open IDP end-session endpoint in tiny popup to clear IDP cookies
        const popup = window.open(res.endSessionUrl, '_blank', 'width=1,height=1,left=-100,top=-100');
        setTimeout(() => {
          try { popup?.close(); } catch (_e) { /* cross-origin */ }
          setLoggingOut(false);
        }, 2000);
        return;
      }
    } catch (err) {
      console.error('[SolidAuth] Logout failed:', err);
    }
    setUser(null);
    setMfaPending(false);
    setLoggingOut(false);
  }, [apiFetch]);

  return {
    user,
    setUser,
    authLoading,
    loggingOut,
    mfaPending,
    handleMfaSuccess,
    providers,
    selectedProvider,
    setSelectedProvider,
    handleLogin,
    logout,
  };
}
