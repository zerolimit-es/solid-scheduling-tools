/**
 * @zerolimit/solid-auth — URL and logging safety helpers
 *
 * Small, dependency-free helpers used by the Express router to validate
 * user-supplied URLs (open-redirect prevention), build redirect URLs, and
 * keep request-controlled values out of log lines unescaped.
 */

/**
 * Parse a string as an http(s) URL. Returns null for anything else
 * (non-strings, other schemes, unparsable input).
 *
 * @param {unknown} value
 * @param {string} [base] — Base URL used to resolve relative paths
 * @returns {URL|null}
 */
export function parseHttpUrl(value, base) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Resolve a user-supplied redirect target against an allowlist of origins.
 *
 * Absolute URLs must share an origin with one of `allowedOrigins`.
 * Relative paths are resolved against the first allowed origin.
 * Returns the resolved absolute URL, or null when the target is not allowed.
 *
 * @param {unknown} candidate       — Raw value (e.g. from req.query)
 * @param {string[]} allowedOrigins — URLs whose origins are permitted
 * @returns {string|null}
 */
export function resolveAllowedRedirect(candidate, allowedOrigins) {
  if (typeof candidate !== 'string' || candidate.length === 0) return null;

  const origins = allowedOrigins
    .map((o) => parseHttpUrl(o)?.origin)
    .filter(Boolean);
  if (origins.length === 0) return null;

  const url = parseHttpUrl(candidate, origins[0]);
  if (!url || !origins.includes(url.origin)) return null;

  return url.href;
}

/**
 * Append query parameters to a URL, preserving any existing query string.
 *
 * @param {string} target
 * @param {Record<string, string>} params
 * @returns {string}
 */
export function appendQueryParams(target, params) {
  const url = parseHttpUrl(target);
  if (url) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.href;
  }
  const query = new URLSearchParams(params).toString();
  return `${target}${target.includes('?') ? '&' : '?'}${query}`;
}

/**
 * Strip line breaks from a value before logging so request-controlled
 * input cannot forge additional log lines.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeForLog(value) {
  return String(value ?? '').replace(/\n|\r/g, '');
}

const SENSITIVE_QUERY_PARAMS = ['code', 'id_token', 'access_token', 'refresh_token'];

/**
 * Produce a log-safe version of a URL with OIDC secrets in the query
 * string redacted (authorization code, tokens).
 *
 * @param {string} urlString
 * @returns {string}
 */
export function redactUrlForLog(urlString) {
  const url = parseHttpUrl(urlString);
  if (!url) return sanitizeForLog(urlString);
  for (const param of SENSITIVE_QUERY_PARAMS) {
    if (url.searchParams.has(param)) url.searchParams.set(param, '[redacted]');
  }
  return sanitizeForLog(url.href);
}
