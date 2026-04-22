---
title: Frontend Svelte Patterns
description: Trellis frontend guidance for Svelte applications and state-management conventions.
order: 80
---

# Design: Frontend Svelte Patterns

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and service boundaries

## Scope

This document defines Trellis frontend guidance for Svelte applications.

## Svelte 5 State Pattern

Conductor-style Svelte apps use Svelte 5 runes for reactive state.

```ts
class Auth {
  #state: AuthState = $state({ handle: null, nonce: null });

  get handle() {
    return this.#state.handle;
  }

  async signIn(options?: {
    redirectTo?: string;
    landingPath?: string;
    context?: unknown;
  }): Promise<void> {
    // mutate #state, reactivity propagates automatically
  }
}

export const authState = new Auth();
```

Patterns:

- private `#state` field with `$state()`
- public getters and no public setters
- methods own mutations
- static factory methods handle async initialization when needed

## Browser App Runtime Pattern

Svelte browser apps should split responsibilities between one app-local module and Svelte context.

```ts
// src/lib/trellis-context.svelte.ts
import { createTrellisProviderContexts } from "@qlever-llc/trellis-svelte";
import { contract } from "$lib/trellis";

export const contexts = createTrellisProviderContexts<typeof contract>();

// src/lib/trellis.ts
import { PUBLIC_TRELLIS_URL } from "$env/static/public";
import { myApp } from "$lib/contracts/my_app";
import { contexts } from "$lib/trellis-context.svelte";

function requirePublicTrellisUrl(): string {
  return new URL(PUBLIC_TRELLIS_URL).toString().replace(/\/$/, "");
}

export const trellisUrl = requirePublicTrellisUrl();
export { myApp as contract };

export const getTrellis = contexts.trellis.getTrellis;
export const getAuth = contexts.auth.getAuth;
export const getConnectionState = contexts.connectionState.getConnectionState;
```

Rules:

- the app-local module owns static app metadata and typed helpers
- in the common fixed-instance case, the app-local module should export the fixed `trellisUrl` and the contract once
- `TrellisProvider` should receive `trellisUrl`, `contract`, `loginPath`, and an app-owned `contexts` bundle created with `createTrellisProviderContexts<typeof contract>()`
- `trellis-svelte` should keep Trellis, auth, and connection state in separate contexts rather than bundling them into a synthetic runtime bag
- normal pages should import app-local helpers such as `getTrellis`, `getAuth`, and `getConnectionState`; they should not rebuild auth config just to make an RPC call
- Svelte context is the runtime transport for the live Trellis instance and related browser state; the app-local module is the static typing boundary that keeps contract knowledge out of arbitrary page files
- SvelteKit static portal or app builds should usually source that fixed instance URL from build-time public env such as `PUBLIC_TRELLIS_URL`
- apps that let the user choose an auth instance at runtime may still need a more dynamic sign-in path, but that should remain an explicit advanced pattern rather than the default guide story
