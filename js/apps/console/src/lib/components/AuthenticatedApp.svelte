<script lang="ts">
  import { goto, afterNavigate } from "$app/navigation";
  import { base } from "$app/paths";
  import { page } from "$app/state";
  import { clearSessionKey } from "@qlever-llc/trellis";
  import type { AuthMeOutput } from "@qlever-llc/trellis/sdk/auth";
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
  import { getAuthenticatedUser, getConnection, getTrellis, logoutAuthenticatedUser, type ConnectionStatus } from "../trellis";
  import AppShell from "./AppShell.svelte";

  type Props = {
    children: Snippet;
  };

  let { children }: Props = $props();

  const connection = getConnection();
  const trellis = getTrellis();
  const notifications = setNotifications(new NotificationsController());

  let authFailure = $state<string | null>(null);
  const connectionStatus = $derived<ConnectionStatus["phase"]>(connection.status.phase);
  let navSections = $state<NavSection[]>(getVisibleNavSections(null));
  let profile = $state<AuthMeOutput["user"] | null>(null);
  let profileLoaded = $state(false);

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

  async function authMe() {
    return await getAuthenticatedUser(trellis);
  }

  async function logoutRequest(): Promise<void> {
    await logoutAuthenticatedUser(trellis);
  }

  async function signOut(): Promise<void> {
    try {
      await logoutRequest();
    } catch {
      // Continue clearing the browser session even if the server logout fails.
    } finally {
      await clearSessionKey();
      window.location.href = buildLoginUrl(currentPath());
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
