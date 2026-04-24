---
title: Frontend Svelte Patterns
description: Trellis frontend guidance for Svelte applications and state-management conventions.
order: 80
---

# Design: Frontend Svelte Patterns

## Prerequisites

- [trellis-patterns.md](./trellis-patterns.md) - Trellis architecture and
  service boundaries

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

Svelte browser apps should split responsibilities between one app-local module
and Svelte context.

```ts
// src/lib/trellis-context.ts
import { createTrellisApp } from "@qlever-llc/trellis-svelte";
import contract from "$lib/contracts/my_app";

export const trellisApp = createTrellisApp(contract);

// src/lib/trellis.ts
import { env } from "$env/dynamic/public";
import type { TrellisClientFor } from "@qlever-llc/trellis-svelte";
import contract from "$lib/contracts/my_app";
import { trellisApp } from "$lib/trellis-context";

function publicTrellisUrl(): string {
  return new URL(env.PUBLIC_TRELLIS_URL ?? "http://localhost:3000")
    .toString()
    .replace(/\/$/, "");
}

export const trellisUrl = publicTrellisUrl();

export function getTrellis<
  TClient = TrellisClientFor<typeof contract>,
>(): TClient {
  return trellisApp.getTrellis<TClient>();
}

export function getConnection() {
  return trellisApp.getConnection();
}
```

Rules:

- the app-local module owns static app metadata and typed helpers
- in the common fixed-instance case, the app-local module should export the
  fixed `trellisUrl` and the contract once
- `TrellisProvider` should receive `trellisUrl` and an app-owned `trellisApp`
  created with `createTrellisApp(contract)`
- `trellis-svelte` should keep the connected Trellis client and reactive
  connection adapter scoped to that app context rather than exposing a synthetic
  runtime bag
- normal pages should import app-local helpers such as `getTrellis` and
  `getConnection`; they should not rebuild auth config just to make an RPC call
- `getTrellis()` and `getConnection()` are Svelte context getters; call them
  during component initialization and store the result in a top-level `const`,
  never inside `onMount`, event handlers, async helper functions, or later
  callbacks
- Svelte context is the runtime transport for the live Trellis instance and
  related browser state; the app-local module is the static typing boundary that
  keeps contract knowledge out of arbitrary page files
- SvelteKit apps should usually source that fixed instance URL from public env
  such as `PUBLIC_TRELLIS_URL`; use `$env/dynamic/public` when local demos need
  a safe default and `$env/static/public` when the value must be fixed at build
  time
- apps that let the user choose an auth instance at runtime may still need a
  more dynamic sign-in path, but that should remain an explicit advanced pattern
  rather than the default guide story
