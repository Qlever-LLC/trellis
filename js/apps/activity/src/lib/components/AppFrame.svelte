<script lang="ts">
  import type { AuthMeOutput } from "@qlever-llc/trellis-sdk/auth";
  import { getAuth, getNatsState } from "@qlever-llc/trellis-svelte";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { errorMessage } from "../format";
  import { getTrellis } from "../trellis";

  let { children } = $props();

  const auth = getAuth();
  const natsStatePromise = getNatsState();

  let authFailure = $state<string | null>(null);
  let connectionStatus = $state("connecting");
  let profile = $state<AuthMeOutput["user"] | null>(null);

  function currentPath(): string {
    return page.url.pathname + page.url.search;
  }

  function connectionBadgeClass(status: string): string {
    if (status === "connected") return "badge-success";
    if (status === "connecting") return "badge-warning";
    return "badge-error";
  }

  function initials(user: AuthMeOutput["user"] | null): string {
    const name = user?.name?.trim();
    if (!name) return "AC";
    const parts = name.split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || name.slice(0, 2).toUpperCase();
  }

  onMount(async () => {
    try {
      const trellis = await getTrellis();
      const me = await trellis.requestOrThrow("Auth.Me", {});
      const natsState = await natsStatePromise;
      const { user } = me;
      profile = user;
      connectionStatus = natsState.status;
    } catch (nextError) {
      authFailure = errorMessage(nextError);
      void goto(`/login?redirectTo=${encodeURIComponent(currentPath())}`);
    }
  });

  async function signOut() {
    try {
      await auth.signOut(async () => {
        const trellis = await getTrellis();
        await trellis.requestOrThrow("Auth.Logout", {});
      });
    } catch {
      // signOut redirects and throws to stop normal control flow
    }
  }
</script>

<svelte:head>
  <title>Activity Console</title>
</svelte:head>

<div class="min-h-screen" data-theme="activity">
  <header class="border-b border-base-300/70 bg-base-100/75 backdrop-blur">
    <div class="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 md:px-6 lg:px-8">
      <div class="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div class="min-w-0">
          <div class="flex items-center gap-4">
            <div class="flex h-14 w-14 items-center justify-center rounded-3xl bg-primary text-primary-content shadow-lg shadow-primary/20">
              <span class="display text-xl font-semibold">A</span>
            </div>
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.34em] text-primary/70">Activity service</p>
              <h1 class="display text-3xl text-base-content md:text-4xl">Operator feed</h1>
            </div>
          </div>
          <p class="mt-4 max-w-3xl text-sm leading-7 text-base-content/70 md:text-base">
            Review connection churn, revocations, and operator actions emitted from the Trellis auth path.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <a class="btn btn-ghost" href="/activity">Dashboard</a>
          <div class={`badge badge-outline ${connectionBadgeClass(connectionStatus)}`}>{connectionStatus}</div>
          <button class="btn btn-primary" onclick={signOut}>Sign out</button>
        </div>
      </div>

      {#if profile}
        <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div class="rounded-box border border-base-300/70 paper-panel p-4 shadow-sm">
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-base-content/50">Current operator</p>
            <div class="mt-3 flex items-center gap-4">
              <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-secondary-content shadow-sm">
                <span class="font-semibold">{initials(profile)}</span>
              </div>
              <div class="min-w-0">
                <p class="truncate text-lg font-semibold text-base-content">{profile.name}</p>
                <p class="truncate text-sm text-base-content/65">{profile.origin}.{profile.id}</p>
              </div>
            </div>
          </div>

          <div class="rounded-box border border-base-300/70 paper-panel px-4 py-3 text-sm text-base-content/70 shadow-sm">
            <p class="font-semibold text-base-content">Access</p>
            <p class="mt-1">{profile.capabilities?.join(", ") ?? "No explicit capabilities"}</p>
          </div>
        </div>
      {/if}
    </div>
  </header>

  <main class="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
    {#if authFailure}
      <div class="alert alert-error">
        <span>{authFailure}</span>
      </div>
    {/if}

    {@render children()}
  </main>
</div>
