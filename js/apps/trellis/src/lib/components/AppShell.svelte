<script lang="ts">
  import type { AuthMeOutput } from "@qlever-llc/trellis-sdk-auth";
  import { getAuth, getNatsState, getTrellisFor } from "@qlever-llc/trellis-svelte";
  import { onMount } from "svelte";
  import { afterNavigate, goto } from "$app/navigation";
  import { page } from "$app/state";
  import { trellisApp } from "../../contracts/trellis_app.ts";
  import { buildAppLoginUrl } from "../config";
  import {
    getInitials,
    getPageTitle,
    getRoleLabel,
    getVisibleNavSections,
    isAdmin,
    requiresAdminRoute
  } from "../control-panel.ts";
  import { errorMessage } from "../format";
  import { NotificationsController, setNotifications } from "../notifications.svelte";
  import ToastViewport from "./ToastViewport.svelte";

  let { children } = $props();

  const auth = getAuth();
  const natsStatePromise = getNatsState();
  const trellisPromise = getTrellisFor(trellisApp);
  const notifications = setNotifications(new NotificationsController());

  let darkMode = $state(
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  let authFailure = $state<string | null>(null);
  let connectionStatus = $state("connecting");
  let drawerOpen = $state(false);
  let navSections = $state(getVisibleNavSections(null));
  let profile = $state<AuthMeOutput["user"] | null>(null);
  let profileLoaded = $state(false);

  const pageTitle = $derived(getPageTitle(page.url.pathname));
  const statusColor = $derived(
    connectionStatus === "connected" ? "text-success" :
    connectionStatus === "connecting" ? "text-warning" : "text-error"
  );

  function currentPath(): string {
    return page.url.pathname + page.url.search;
  }

  function closeDrawer(): void {
    drawerOpen = false;
  }

  function toggleTheme(): void {
    darkMode = !darkMode;
    document.documentElement.setAttribute("data-theme", darkMode ? "dracula" : "corporate");
  }

  function enforceAdminAccess(pathname: string): void {
    if (!profileLoaded || !requiresAdminRoute(pathname) || isAdmin(profile)) {
      return;
    }
    authFailure = "Administrator access is required for operations pages.";
    closeDrawer();
    void goto("/profile");
  }

  onMount(() => {
    let active = true;
    let statusInterval: number | null = null;

    void (async () => {
      try {
        const natsState = await natsStatePromise;
        if (!active) return;

        connectionStatus = natsState.status;
        statusInterval = window.setInterval(() => {
          connectionStatus = natsState.status;
        }, 1000);

        const me = await (await trellisPromise).requestOrThrow("Auth.Me", {});
        if (!active) return;

        if (me.user) {
          profile = me.user;
          navSections = getVisibleNavSections(profile);
        }
      } catch (error) {
        if (!active) return;
        authFailure = errorMessage(error);
        window.location.href = buildAppLoginUrl(currentPath());
      } finally {
        if (active) {
          profileLoaded = true;
          enforceAdminAccess(page.url.pathname);
        }
      }
    })();

    afterNavigate(({ to }) => {
      if (!to) return;
      enforceAdminAccess(to.url.pathname);
    });

    return () => {
      active = false;
      notifications.clear();
      if (statusInterval !== null) {
        window.clearInterval(statusInterval);
      }
    };
  });

  async function logoutRequest(): Promise<void> {
    await (await trellisPromise).requestOrThrow("Auth.Logout", {});
  }

  async function signOut() {
    await auth.signOut(logoutRequest);
  }
</script>

<svelte:head>
  <title>{pageTitle} · Trellis</title>
</svelte:head>

<a class="skip-link btn btn-sm btn-primary" href="#trellis-main">Skip to main content</a>

<div class="drawer min-h-screen lg:drawer-open" data-theme={darkMode ? "dracula" : "corporate"}>
  <input id="trellis-nav" type="checkbox" class="drawer-toggle" bind:checked={drawerOpen} />

  <div class="drawer-content flex flex-col">
    <header class="navbar bg-base-100 border-b border-base-300 sticky top-0 z-30">
      <div class="flex-none lg:hidden">
        <button
          type="button"
          class="btn btn-square btn-ghost"
          aria-label="Open navigation"
          onclick={() => { drawerOpen = !drawerOpen; }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-5 w-5 fill-none stroke-current" stroke-width="1.8">
            <path stroke-linecap="round" d="M4 7h16M4 12h16M4 17h16"></path>
          </svg>
        </button>
      </div>
      <div class="flex-1 px-2">
        <h1 class="text-lg font-semibold">{pageTitle}</h1>
      </div>
      <div class="flex-none">
        <label class="swap swap-rotate btn btn-ghost btn-square btn-sm">
          <input type="checkbox" checked={darkMode} onchange={toggleTheme} />
          <svg class="swap-off h-5 w-5 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13ZM18,22A10.11,10.11,0,0,1,6,13.09,10.28,10.28,0,0,1,11.09,4,12.09,12.09,0,0,0,17,6.86,6.15,6.15,0,0,0,23.14,13,10.11,10.11,0,0,1,18,22Z"/></svg>
          <svg class="swap-on h-5 w-5 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7a1,1,0,0,0,1-1V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29,1,1,0,0,0,0-1.41l-.71-.71A1,1,0,0,0,4.93,6.34Zm12,.29a1,1,0,0,0,.7-.29l.71-.71a1,1,0,1,0-1.41-1.41L17,5.64a1,1,0,0,0,0,1.41A1,1,0,0,0,17.66,7.34ZM21,11H20a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2Zm-9,8a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V20A1,1,0,0,0,12,19ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z"/></svg>
        </label>
      </div>
    </header>

    <main id="trellis-main" tabindex="-1" class="flex-1 p-4 lg:p-6 max-w-7xl w-full mx-auto">
      {#if authFailure}
        <div class="alert alert-error mb-4">
          <span>{authFailure}</span>
        </div>
      {/if}

      {#if requiresAdminRoute(page.url.pathname) && !profileLoaded}
        <div class="flex items-center justify-center min-h-[40vh]">
          <span class="loading loading-spinner loading-md"></span>
        </div>
      {:else}
        {@render children()}
      {/if}
    </main>

    <ToastViewport />
  </div>

  <div class="drawer-side z-40">
    <label for="trellis-nav" class="drawer-overlay" aria-hidden="true"></label>

    <aside class="bg-base-200 min-h-full w-64 flex flex-col">
      <div class="p-4 border-b border-base-300">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-lg font-bold">Trellis</span>
            <span class={`inline-block w-2 h-2 rounded-full ${statusColor}`}></span>
          </div>
          <button type="button" class="btn btn-square btn-ghost btn-sm lg:hidden" aria-label="Close navigation" onclick={closeDrawer}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-4 w-4 fill-none stroke-current" stroke-width="1.8">
              <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18"></path>
            </svg>
          </button>
        </div>
      </div>

      <nav class="flex-1 p-4" aria-label="Primary">
        {#each navSections as section}
          <div class="mb-4">
            <p class="text-xs font-semibold uppercase tracking-wider text-base-content/50 mb-2 px-2">{section.title}</p>
            <ul class="menu menu-sm gap-1">
              {#each section.items as item}
                <li>
                  <a
                    href={item.href}
                    class:active={page.url.pathname === item.href}
                    aria-current={page.url.pathname === item.href ? "page" : undefined}
                    onclick={closeDrawer}
                  >
                    {item.label}
                  </a>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </nav>

      {#if profile}
        <div class="p-4 border-t border-base-300">
          <div class="flex items-center gap-3 mb-2">
            {#if profile.image}
              <div class="avatar">
                <div class="w-8 rounded-full">
                  <img src={profile.image} alt={profile.name} />
                </div>
              </div>
            {:else}
              <div class="avatar avatar-placeholder">
                <div class="bg-neutral text-neutral-content w-8 rounded-full">
                  <span class="text-xs">{getInitials(profile)}</span>
                </div>
              </div>
            {/if}
            <div class="min-w-0">
              <p class="text-sm font-medium truncate">{profile.name}</p>
              <p class="text-xs text-base-content/60">{getRoleLabel(profile)}</p>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm btn-block justify-start" onclick={signOut}>Sign out</button>
        </div>
      {/if}
    </aside>
  </div>
</div>
