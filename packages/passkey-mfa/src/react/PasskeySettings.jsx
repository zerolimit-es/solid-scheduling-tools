/**
 * @zerolimit/passkey-mfa/react — PasskeySettings
 *
 * Settings UI for registering and managing passkeys. Lists existing
 * passkeys with metadata and provides registration + deletion controls.
 */

import { useState, useEffect, useCallback } from 'react';
import { startRegistration } from '@simplewebauthn/browser';

/**
 * @param {Object} props
 * @param {string} [props.apiBase=''] — API base URL
 * @param {(endpoint: string, options?: RequestInit) => Promise<any>} [props.apiFetch] — Custom fetch
 */
export function PasskeySettings({ apiBase = '', apiFetch }) {
  const [passkeys, setPasskeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [deviceName, setDeviceName] = useState('');

  const fetchFn = useCallback(
    async (endpoint, options) => {
      if (apiFetch) return apiFetch(endpoint, options);
      const res = await fetch(`${apiBase}${endpoint}`, {
        ...options,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options?.headers },
      });
      return res.json();
    },
    [apiBase, apiFetch],
  );

  useEffect(() => {
    let cancelled = false;
    fetchFn('/api/auth/passkey/list')
      .then((res) => { if (!cancelled) setPasskeys(res.passkeys || []); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchFn]);

  const handleRegister = async () => {
    setRegistering(true);
    setError(null);
    try {
      const options = await fetchFn('/api/auth/passkey/register-options');
      const credential = await startRegistration({ optionsJSON: options });
      const res = await fetchFn('/api/auth/passkey/register-verify', {
        method: 'POST',
        body: JSON.stringify({ body: credential, deviceName: deviceName || undefined }),
      });
      setPasskeys((prev) => [...prev, res.passkey]);
      setDeviceName('');
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setError('Registration was cancelled.');
      } else {
        setError(err.message || 'Registration failed');
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (id) => {
    if (!globalThis.confirm?.('Remove this passkey? If it is your only passkey, MFA will be disabled.')) return;
    try {
      await fetchFn(`/api/auth/passkey/${id}`, { method: 'DELETE' });
      setPasskeys((prev) => prev.filter((pk) => pk.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return <div style={{ padding: 16, color: '#888' }}>Loading passkeys...</div>;
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 8px' }}>Passkeys (MFA)</h3>
      <p style={{ color: '#666', fontSize: 14, margin: '0 0 16px' }}>
        Add a passkey to require a second factor after signing in.
      </p>

      {error && (
        <div style={{ color: '#dc2626', background: 'rgba(239,68,68,0.1)', padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      {passkeys.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {passkeys.map((pk) => (
            <div key={pk.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 8 }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: 14 }}>{pk.deviceName || 'Passkey'}</div>
                <div style={{ fontSize: 12, color: '#888' }}>
                  Added {new Date(pk.createdAt).toLocaleDateString()}
                  {pk.lastUsedAt && ` \u00B7 Last used ${new Date(pk.lastUsedAt).toLocaleDateString()}`}
                </div>
              </div>
              <button onClick={() => handleDelete(pk.id)} style={{ padding: '4px 12px', fontSize: 13, cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: 6, background: 'transparent' }}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Device name (optional)</label>
          <input
            type="text"
            placeholder="e.g. MacBook Touch ID"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
          />
        </div>
        <button
          onClick={handleRegister}
          disabled={registering}
          style={{ padding: '8px 16px', fontSize: 14, fontWeight: 500, cursor: registering ? 'wait' : 'pointer', border: 'none', borderRadius: 6, background: 'var(--color-primary, #2563eb)', color: '#fff', whiteSpace: 'nowrap' }}
        >
          {registering ? 'Registering...' : 'Register Passkey'}
        </button>
      </div>
    </div>
  );
}
