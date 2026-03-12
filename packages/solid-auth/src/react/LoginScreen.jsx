/**
 * @zerolimit/solid-auth/react — LoginScreen Component
 *
 * A ready-to-use login screen with Solid OIDC provider selection.
 * Can be used as-is or customised via props and CSS classes.
 *
 * For fully custom UI, use the useAuth() hook directly instead.
 */

import React, { useState } from 'react';

/**
 * Default login screen with provider dropdown and login button.
 *
 * @param {Object} props
 * @param {import('../core/types.js').SolidProvider[]} props.providers
 * @param {string} props.selectedProvider
 * @param {(url: string) => void} props.onProviderChange
 * @param {() => void} props.onLogin
 * @param {string} [props.title='Solid Login']
 * @param {string} [props.subtitle='Decentralized authentication']
 * @param {string} [props.description]
 * @param {string} [props.loginButtonText='Login with Solid']
 * @param {boolean} [props.showGetPodLink=true]
 * @param {string} [props.className]
 * @param {React.ReactNode} [props.logo]
 * @param {React.ReactNode} [props.children] — Extra content below the login button
 */
export function LoginScreen({
  providers,
  selectedProvider,
  onProviderChange,
  onLogin,
  title = 'Solid Login',
  subtitle = 'Decentralized authentication',
  description = 'Your data stays in your personal Solid Pod. Connect your identity to get started.',
  loginButtonText = 'Login with Solid',
  showGetPodLink = true,
  className = '',
  logo = null,
  children = null,
}) {
  const [customUrl, setCustomUrl] = useState('');
  const selfHostedSelected = selectedProvider === '' || selectedProvider === null;

  const handleProviderChange = (e) => {
    const value = e.target.value;
    onProviderChange(value === '__custom__' ? '' : value);
  };

  const handleLogin = () => {
    if (selfHostedSelected && customUrl) {
      // Temporarily switch to the custom URL for this login
      onProviderChange(customUrl);
      // Give state a tick to update, then login
      setTimeout(onLogin, 0);
    } else {
      onLogin();
    }
  };

  return (
    <div className={`solid-auth-login-screen ${className}`}>
      <div className="solid-auth-login-card">
        <div className="solid-auth-login-header">
          {logo}
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="solid-auth-login-content">
          {description && (
            <p className="solid-auth-login-description">{description}</p>
          )}
          <div className="solid-auth-provider-select">
            <label>Solid Identity Provider</label>
            <select
              value={selfHostedSelected ? '__custom__' : selectedProvider}
              onChange={handleProviderChange}
            >
              {providers.map(p =>
                p.url === null ? (
                  <option key="__custom__" value="__custom__">
                    {p.name}
                  </option>
                ) : (
                  <option key={p.url} value={p.url}>
                    {p.name}
                  </option>
                )
              )}
            </select>
          </div>

          {selfHostedSelected && (
            <div className="solid-auth-custom-url">
              <label>Identity Provider URL</label>
              <input
                type="url"
                placeholder="https://your-solid-server.example"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
              />
            </div>
          )}

          <button
            className="solid-auth-login-btn"
            onClick={handleLogin}
            disabled={selfHostedSelected && !customUrl}
          >
            {loginButtonText}
          </button>

          {children}

          {showGetPodLink && (
            <div className="solid-auth-login-footer">
              <p>Don't have a Solid Pod?</p>
              <a
                href="https://solidproject.org/users/get-a-pod"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get one free →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
