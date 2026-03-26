# Solid Scheduling Tools

Shared libraries for [Proton Scheduler](https://github.com/zerolimit-es/proton-scheduler) — a privacy-first scheduling app built on the [Solid Protocol](https://solidproject.org/).

This monorepo contains three packages:

| Package | Description |
|---------|-------------|
| [**solid-auth**](packages/solid-auth/) | Solid OIDC authentication, session management, and Pod discovery |
| [**passkey-mfa**](packages/passkey-mfa/) | WebAuthn/FIDO2 passkey multi-factor authentication |
| [**solid-pod-sync**](packages/solid-pod-sync/) | Solid Pod CRUD operations, RDF vocabulary, and recurrence utilities |

## Installation

```bash
npm install git+https://github.com/zerolimit-es/solid-scheduling-tools.git
```

Import using subpath exports:

```js
// Core (framework-agnostic)
import { SolidSessionManager } from '@zerolimit/packages/solid-auth/core';
import { createMemoryChallengeStore } from '@zerolimit/packages/passkey-mfa/core';
import { saveBooking, parseRRule } from '@zerolimit/packages/solid-pod-sync/core';

// Express middleware & routers
import { createAuthRouter } from '@zerolimit/packages/solid-auth/express';
import { createPasskeyRouter } from '@zerolimit/packages/passkey-mfa/express';
import { createSyncRouter } from '@zerolimit/packages/solid-pod-sync/express';

// React hooks & components
import { useAuth } from '@zerolimit/packages/solid-auth/react';
import { PasskeyChallenge, PasskeySettings } from '@zerolimit/packages/passkey-mfa/react';
```

## Peer Dependencies

| Dependency | Required by | Required? |
|-----------|------------|-----------|
| `@inrupt/solid-client` | solid-auth, solid-pod-sync | Yes |
| `@inrupt/solid-client-authn-node` | solid-auth | Yes |
| `@simplewebauthn/server` | passkey-mfa | Yes |
| `@simplewebauthn/browser` | passkey-mfa (react) | Optional |
| `express` | All (express subpaths) | Optional |
| `react` | solid-auth, passkey-mfa (react) | Optional |
| `ioredis` | solid-auth, passkey-mfa (Redis stores) | Optional |

## Architecture

Each package follows the same structure:

```
packages/<name>/src/
  core/       # Framework-agnostic logic and types
  express/    # Express routers and middleware
  react/      # React hooks and components (where applicable)
```

All stores (session, challenge, credential) are injectable — no hardcoded database or Redis dependencies. You provide the storage backend that fits your stack.

## License

MIT
