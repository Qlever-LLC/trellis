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
// src/lib/trellis.ts
import { env } from "$env/dynamic/public";
import {
  createTrellisApp,
  type TrellisClientFor,
} from "@qlever-llc/trellis-svelte";
import contract from "$lib/contract";

type MyAppClient = TrellisClientFor<typeof contract>;

function publicTrellisUrl(): string {
  return new URL(env.PUBLIC_TRELLIS_URL ?? "http://localhost:3000")
    .toString()
    .replace(/\/$/, "");
}

export const trellisUrl = publicTrellisUrl();

export const trellisApp = createTrellisApp({ contract, trellisUrl });

export function getTrellis(): MyAppClient {
  return trellisApp.getTrellis();
}

export function getConnection() {
  return trellisApp.getConnection();
}
```

Rules:

- the app-local module owns static app metadata and typed helpers
- browser apps should let `createTrellisApp` derive the connected client type
  from the app contract, using `TrellisClientFor<typeof contract>` for local
  helper annotations when an explicit name is useful
- in the common fixed-instance case, the app-local module should resolve the
  fixed `trellisUrl` once and pass it to `createTrellisApp`
- `TrellisProvider` should receive an app-owned `trellisApp` created with
  `createTrellisApp({ contract, trellisUrl })`
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
- generated client facades are not needed for Svelte app-local helpers; the app
  contract is the typing source for `createTrellisApp` and `TrellisProvider`
- SvelteKit apps should usually source that fixed instance URL from public env
  such as `PUBLIC_TRELLIS_URL`; use `$env/dynamic/public` when local demos need
  a safe default and `$env/static/public` when the value must be fixed at build
  time
- apps that let the user choose an auth instance at runtime should pass a
  resolver to `createTrellisApp`, for example `trellisUrl: () => selectedUrl`,
  and update that selected value before rendering `TrellisProvider`; this should
  remain an explicit advanced pattern rather than the default guide story

## Local Workspace Alias Pattern

SvelteKit apps that consume local workspace packages must keep Deno, Vite, and
the Svelte/TypeScript editor on the same package graph.

Rules:

- installed registry packages do not need aliases; let the package manager and
  normal resolver handle them
- local generated service SDK packages need SvelteKit aliases unless they are
  installed packages
- if Trellis itself is local-linked, alias the package root
  `@qlever-llc/trellis` and every Trellis subpath the app or generated SDKs
  import
- keep local frontend aliases in the app's `svelte.config.js` `kit.alias`
  object; SvelteKit generates the `.svelte-kit/tsconfig.json` path mappings used
  by editor tooling and `svelte-check`, and passes those aliases to Vite for
  SvelteKit builds
- do not duplicate the same local package mappings in `vite.config.js`
- order explicit alias entries from most specific to least specific, with
  Trellis subpaths before the `@qlever-llc/trellis` package root, because Vite
  resolves aliases by prefix

The Trellis repo's local frontend apps keep explicit `kit.alias` objects in each
SvelteKit config. App workspaces that define their own local generated SDK
package names should add those package names to their app-local aliases, for
example `@trellis-sdk/trellis-demo-service` in the demo workspace.
