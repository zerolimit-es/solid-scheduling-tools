/**
 * @zerolimit/passkey-mfa/react — PasskeyChallenge
 *
 * Full-screen MFA challenge component displayed after OIDC login
 * when the user has passkeys registered. Calls the backend auth
 * endpoints and invokes onSuccess when verification passes.
 */

import { useState, useCallback } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';

/**
 * @param {Object} props
 * @param {() => void} props.onSuccess — Called after successful verification
 * @param {string} [props.apiBase=''] — API base URL
 * @param {(endpoint: string, options?: RequestInit) => Promise<any>} [props.apiFetch] — Custom fetch
 */
export function PasskeyChallenge({ onSuccess, apiBase = '', apiFetch }) {
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);

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

  const handleVerify = async () => {
    setVerifying(true);
    setError(null);
    try {
      const options = await fetchFn('/api/auth/passkey/auth-options');
      const credential = await startAuthentication({ optionsJSON: options });
      await fetchFn('/api/auth/passkey/auth-verify', {
        method: 'POST',
        body: JSON.stringify({ body: credential }),
      });
      onSuccess();
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setError('Passkey verification was cancelled or timed out.');
      } else {
        setError(err.message || 'Verification failed');
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 420, width: '100%', padding: 32, background: 'var(--theme-card-bg, #fff)', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>&#x1F511;</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Passkey Verification</h2>
          <p style={{ margin: 0, color: '#666', fontSize: 14 }}>
            Use your registered passkey to complete sign-in.
          </p>
        </div>

        {error && (
          <div style={{ color: '#dc2626', background: 'rgba(239,68,68,0.1)', padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        <button
          onClick={handleVerify}
          disabled={verifying}
          style={{ width: '100%', padding: '12px 16px', fontSize: 15, fontWeight: 500, cursor: verifying ? 'wait' : 'pointer', border: 'none', borderRadius: 8, background: 'var(--color-primary, #2563eb)', color: '#fff' }}
        >
          {verifying ? 'Verifying...' : 'Verify with Passkey'}
        </button>
      </div>
    </div>
  );
}
