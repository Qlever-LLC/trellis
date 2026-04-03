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

  async signIn(provider: string): Promise<void> {
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
