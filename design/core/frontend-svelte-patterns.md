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
// src/lib/trellis.ts
import { createTrellisApp } from "@qlever-llc/trellis-svelte";
import { myApp } from "$lib/contracts/my_app";

export const app = createTrellisApp({
  authUrl: "http://localhost:3000",
  contract: myApp,
  loginPath: "/login",
});

export const getTrellis = app.getTrellis;
```

Rules:

- the app-local module owns static app metadata and typed helpers
- in the common fixed-instance case, `createTrellisApp(...)` should accept `authUrl` and own the auth state internally rather than forcing apps to create a second exported `auth` object
- `TrellisProvider` should receive that one `app` object and place the live auth, NATS, and Trellis runtimes into Svelte context
- normal pages should import typed helpers such as `getTrellis` from the app-local module; they should not rebuild auth config just to make an RPC call
- Svelte context is the runtime transport for the live Trellis instance; the app-local module is the static typing boundary that keeps contract knowledge out of arbitrary page files
- apps that let the user choose an auth instance at runtime may still need a more dynamic sign-in path, but that should remain an explicit advanced pattern rather than the default guide story
