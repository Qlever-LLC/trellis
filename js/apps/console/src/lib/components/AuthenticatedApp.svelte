<script lang="ts">
  import { goto, afterNavigate } from "$app/navigation";
  import { base } from "$app/paths";
  import { page } from "$app/state";
  import type { AuthMeOutput } from "@qlever-llc/trellis-sdk/auth";
  import type { Snippet } from "svelte";
  import { onDestroy, onMount } from "svelte";
  import {
    getVisibleNavSections,
    isAdmin,
    requiresAdminRoute,
    type NavSection,
  } from "../control-panel.ts";
  import { APP_CONFIG, getSelectedAuthUrl } from "../config";
  import { errorMessage } from "../format";
  import { NotificationsController, setNotifications } from "../notifications.svelte";
  import { getAuth, getConnectionState, getTrellis, type ConnectionState } from "../trellis";
  import AppShell from "./AppShell.svelte";

  type Props = {
    children: Snippet;
  };

  let { children }: Props = $props();

  const auth = getAuth();
  const connectionStatePromise = getConnectionState();
  const trellisPromise = getTrellis();
  const notifications = setNotifications(new NotificationsController());

  let authFailure = $state<string | null>(null);
  let connectionStatus = $state<ConnectionState["status"]>("connecting");
  let navSections = $state<NavSection[]>(getVisibleNavSections(null));
  let profile = $state<AuthMeOutput["user"] | null>(null);
  let profileLoaded = $state(false);

  let statusInterval: ReturnType<typeof globalThis.setInterval> | null = null;

  function resolveAppPath(path: string): string {
    return `${base}${path}`;
  }

  function toRoutePath(pathname: string): string {
    if (base && pathname === base) {
      return "/";
    }

    if (base && pathname.startsWith(`${base}/`)) {
      return pathname.slice(base.length);
    }

    return pathname;
  }

  function buildLoginUrl(redirectTo: string): string {
    const url = new URL(resolveAppPath("/login"), page.url);
    url.searchParams.set("redirectTo", redirectTo);

    const authUrl = getSelectedAuthUrl(page.url);
    if (authUrl && authUrl !== APP_CONFIG.authUrl) {
      url.searchParams.set("authUrl", authUrl);
    }

    return url.toString();
  }

  function currentPath(): string {
    return page.url.pathname + page.url.search;
  }

  function enforceAdminAccess(pathname: string): void {
    if (!profileLoaded || !requiresAdminRoute(pathname) || isAdmin(profile)) {
      return;
    }

    authFailure = "Administrator access is required for operations pages.";
    void goto(resolveAppPath("/profile"));
  }

  async function authMe(): Promise<AuthMeOutput> {
    const trellis = await trellisPromise;
    return await trellis.request<AuthMeOutput>("Auth.Me", {}).orThrow();
  }

  async function logoutRequest(): Promise<void> {
    const trellis = await trellisPromise;
    await trellis.request<void>("Auth.Logout", {}).orThrow();
  }

  async function signOut(): Promise<void> {
    try {
      await auth.signOut(logoutRequest);
    } catch {
      // signOut redirects and throws to stop normal control flow
    }
  }

  afterNavigate(({ to }) => {
    if (!to) return;
    enforceAdminAccess(toRoutePath(to.url.pathname));
  });

  onMount(() => {
    let active = true;

    void (async () => {
      try {
        const connectionState = await connectionStatePromise;
        if (!active) return;

        connectionStatus = connectionState.status;
        statusInterval = globalThis.setInterval(() => {
          connectionStatus = connectionState.status;
        }, 1000);

        const me = await authMe();
        if (!active) return;

        if (me.user) {
          profile = me.user;
          navSections = getVisibleNavSections(profile);
        }
      } catch (error) {
        if (!active) return;
        authFailure = errorMessage(error);
        window.location.href = buildLoginUrl(currentPath());
      } finally {
        if (active) {
          profileLoaded = true;
          enforceAdminAccess(toRoutePath(page.url.pathname));
        }
      }
    })();

    return () => {
      active = false;
    };
  });

  onDestroy(() => {
    notifications.clear();
    if (statusInterval !== null) {
      globalThis.clearInterval(statusInterval);
    }
  });
</script>

<AppShell
  {profile}
  {profileLoaded}
  {navSections}
  {connectionStatus}
  {authFailure}
  onSignOut={signOut}
>
  {@render children()}
</AppShell>
