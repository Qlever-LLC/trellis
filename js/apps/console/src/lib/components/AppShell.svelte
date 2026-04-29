<script lang="ts">
  import type { AuthMeOutput } from "@qlever-llc/trellis/sdk/auth";
  import { afterNavigate } from "$app/navigation";
  import { base, resolve } from "$app/paths";
  import { page } from "$app/state";
  import type { Snippet } from "svelte";
  import type { ConnectionStatus } from "../trellis";
  import { consoleTheme } from "../theme.svelte";
  import {
    getInitials,
    getPageTitle,
    getRoleLabel,
    requiresAdminRoute,
    type NavSection,
  } from "../control-panel.ts";
  import Icon from "./Icon.svelte";
  import LoadingState from "./LoadingState.svelte";
  import StatusBadge from "./StatusBadge.svelte";
  import ToastViewport from "./ToastViewport.svelte";

  type Props = {
    children: Snippet;
    profile: AuthMeOutput["user"] | null;
    profileLoaded: boolean;
    navSections: NavSection[];
    connectionStatus: ConnectionStatus["phase"];
    authFailure: string | null;
    onSignOut: () => Promise<void> | void;
  };

  let {
    children,
    profile,
    profileLoaded,
    navSections,
    connectionStatus,
    authFailure,
    onSignOut,
  }: Props = $props();

  let drawerOpen = $state(false);

  const routePath = $derived(toRoutePath(page.url.pathname));
  const pageTitle = $derived(getPageTitle(routePath));
  const connectionLabel = $derived(
    connectionStatus === "connected" ? "Connected" :
      connectionStatus === "reconnecting" ? "Reconnecting" : "Offline"
  );
  const connectionVariant = $derived(
    connectionStatus === "connected" ? "healthy" :
      connectionStatus === "reconnecting" ? "degraded" : "unhealthy"
  );

  function toRoutePath(pathname: string): string {
    if (base && pathname === base) {
      return "/";
    }

    if (base && pathname.startsWith(`${base}/`)) {
      return pathname.slice(base.length);
    }

    return pathname;
  }

  function closeDrawer(): void {
    drawerOpen = false;
  }

  afterNavigate(() => {
    closeDrawer();
  });
</script>

<svelte:head>
  <title>{pageTitle} · Trellis</title>
</svelte:head>

<a class="skip-link btn btn-sm btn-primary" href="#trellis-main">Skip to main content</a>

<div class="drawer min-h-screen bg-base-200 lg:drawer-open">
  <input id="trellis-nav" type="checkbox" class="drawer-toggle" bind:checked={drawerOpen} />

  <div class="drawer-content flex min-w-0 flex-col">
    <header class="navbar trellis-topbar sticky top-0 z-30 h-16 min-h-16 border-b border-base-300 bg-base-100/95 px-4 backdrop-blur lg:px-7">
      <div class="navbar-start gap-3">
        <button
          type="button"
          class="btn btn-square btn-ghost"
          aria-label="Toggle navigation"
          onclick={() => { drawerOpen = !drawerOpen; }}
        >
          <Icon name="menu" size={20} />
        </button>
        <label class="input input-bordered input-sm hidden w-[420px] items-center gap-2 bg-base-100 shadow-sm md:flex">
          <Icon name="search" size={16} class="opacity-50" />
          <input type="search" class="grow" placeholder="Search or run command..." aria-label="Search or run command" readonly />
          <kbd class="kbd kbd-xs">⌘ K</kbd>
        </label>
      </div>
      <div class="navbar-end gap-2 sm:gap-3">
        <StatusBadge label={`${connectionLabel}: Trellis`} status={connectionVariant} class="hidden sm:inline-flex px-3" />
        <div class="divider divider-horizontal mx-0 hidden lg:flex"></div>
        <label class="swap swap-rotate btn btn-ghost btn-square btn-sm">
          <input type="checkbox" checked={consoleTheme.darkMode} onchange={() => consoleTheme.toggle()} aria-label="Toggle dark mode" />
          <Icon name="sun" size={20} class="swap-off" />
          <Icon name="moon" size={20} class="swap-on" />
        </label>
        <button class="btn btn-ghost btn-square btn-sm" aria-label="Notifications">
          <Icon name="bell" size={20} />
        </button>
        {#if profile}
          <details class="dropdown dropdown-end">
            <summary class="btn btn-ghost gap-2 rounded-full pr-2" aria-label="Open user menu">
              {#if profile.image}
                <div class="avatar">
                  <div class="w-8 rounded-full">
                    <img src={profile.image} alt={profile.name} />
                  </div>
                </div>
              {:else}
                <div class="avatar avatar-placeholder">
                  <div class="w-8 rounded-full bg-neutral text-neutral-content">
                    <span class="text-xs">{getInitials(profile)}</span>
                  </div>
                </div>
              {/if}
              <Icon name="chevronDown" size={16} class="opacity-60" />
            </summary>
            <div class="menu dropdown-content z-50 mt-3 w-64 rounded-box border border-base-300 bg-base-100 p-2 shadow-sm">
              <div class="px-2 py-2">
                <p class="truncate text-sm font-medium">{profile.name}</p>
                <p class="text-xs text-base-content/60">{getRoleLabel(profile)}</p>
              </div>
              <button type="button" class="btn btn-ghost btn-sm justify-start" onclick={onSignOut}>Sign out</button>
            </div>
          </details>
        {/if}
      </div>
    </header>

    <main id="trellis-main" tabindex="-1" class="mx-auto w-full max-w-[1500px] flex-1 px-4 py-7 outline-none lg:px-8">
      {#if authFailure}
        <div class="alert alert-error mb-4">
          <span>{authFailure}</span>
        </div>
      {/if}

      {#if requiresAdminRoute(routePath) && !profileLoaded}
        <LoadingState label="Loading operator profile" class="min-h-[40vh]" />
      {:else}
        {@render children()}
      {/if}
    </main>

    <ToastViewport />
  </div>

  <div class="drawer-side z-40">
    <label for="trellis-nav" class="drawer-overlay" aria-hidden="true"></label>

    <aside class="trellis-sidebar flex min-h-full w-[251px] flex-col">
      <div class="flex h-[76px] items-center gap-3 px-6">
        <div class="grid h-9 w-9 place-items-center rounded-xl border border-success/40 bg-success/10 text-success">
          <Icon name="cpu" size={22} />
        </div>
        <div>
          <div class="text-2xl font-semibold leading-none tracking-tight text-white">Trellis</div>
          <div class="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Console</div>
        </div>
        <button type="button" class="btn btn-square btn-ghost btn-sm ml-auto lg:hidden" aria-label="Close navigation" onclick={closeDrawer}>
          <Icon name="menu" size={18} />
        </button>
      </div>

      <div class="hidden border-b border-neutral-content/10"></div>

      <nav class="flex-1 space-y-8 overflow-y-auto px-3 pt-3" aria-label="Primary">
        {#each navSections as section (section.title)}
          <div>
            <p class="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{section.title}</p>
            <ul class="menu gap-1 p-0">
              {#each section.items as item (item.href)}
                <li>
                  {#if item.href === "/admin"}
                    <a href={resolve("/admin")} class={{ active: routePath === item.href }} aria-current={routePath === item.href ? "page" : undefined} onclick={closeDrawer}><Icon name={item.icon} size={16} />{item.label}</a>
                  {:else if item.href === "/admin/health-events"}
                    <a href={resolve("/admin/health-events")} class={{ active: routePath === item.href }} aria-current={routePath === item.href ? "page" : undefined} onclick={closeDrawer}><Icon name={item.icon} size={16} />{item.label}</a>
                  {:else if item.href === "/admin/sessions"}
                    <a href={resolve("/admin/sessions")} class={{ active: routePath === item.href }} aria-current={routePath === item.href ? "page" : undefined} onclick={closeDrawer}><Icon name={item.icon} size={16} />{item.label}</a>
                  {:else if item.href === "/admin/jobs"}
                    <a href={resolve("/admin/jobs")} class={{ active: routePath === item.href }} aria-current={routePath === item.href ? "page" : undefined} onclick={closeDrawer}><Icon name={item.icon} size={16} />{item.label}</a>
                  {:else if item.href === "/admin/contracts"}
                    <a href={resolve("/admin/contracts")} class={{ active: routePath === item.href }} aria-current={routePath === item.href ? "page" : undefined} onclick={closeDrawer}><Icon name={item.icon} size={16} />{item.label}</a>
                  {:else if item.href === "/admin/services"}
                    <a href={resolve("/admin/services")} class={{ active: routePath === item.href }} aria-current={routePath === item.href ? "page" : undefined} onclick={closeDrawer}><Icon name={item.icon} size={16} />{item.label}</a>
                  {:else if item.href === "/admin/devices/instances"}
                    <a href={resolve("/admin/devices/instances")} class={{ active: routePath === item.href }} aria-current={routePath === item.href ? "page" : undefined} onclick={closeDrawer}><Icon name={item.icon} size={16} />{item.label}</a>
                  {:else if item.href === "/admin/users"}
                    <a href={resolve("/admin/users")} class={{ active: routePath === item.href }} aria-current={routePath === item.href ? "page" : undefined} onclick={closeDrawer}><Icon name={item.icon} size={16} />{item.label}</a>
                  {:else if item.href === "/admin/app-grants"}
                    <a href={resolve("/admin/app-grants")} class={{ active: routePath === item.href }} aria-current={routePath === item.href ? "page" : undefined} onclick={closeDrawer}><Icon name={item.icon} size={16} />{item.label}</a>
                  {:else if item.href === "/admin/portals"}
                    <a href={resolve("/admin/portals")} class={{ active: routePath === item.href }} aria-current={routePath === item.href ? "page" : undefined} onclick={closeDrawer}><Icon name={item.icon} size={16} />{item.label}</a>
                  {:else}
                    <a href={resolve("/profile")} class={{ active: routePath === item.href }} aria-current={routePath === item.href ? "page" : undefined} onclick={closeDrawer}><Icon name={item.icon} size={16} />{item.label}</a>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </nav>

      <div class="m-3 rounded-box border border-white/10 bg-white/5 p-4 text-sm">
        <div class="mb-3 flex items-center gap-2 text-slate-100">
          <span class="h-2.5 w-2.5 rounded-full bg-success"></span>
          Connected: Trellis
        </div>
        <div class="text-slate-400">Trellis Runtime</div>
        <div class="mt-1 text-xs text-slate-500">v1.12.3</div>
      </div>
    </aside>
  </div>
</div>
