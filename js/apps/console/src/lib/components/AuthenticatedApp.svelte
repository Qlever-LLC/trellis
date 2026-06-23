<script lang="ts">
  import { goto, afterNavigate } from "$app/navigation";
  import { base } from "$app/paths";
  import { page } from "$app/state";
  import type { AuthSessionsMeOutput } from "@qlever-llc/trellis/sdk/auth";
  import type { Snippet } from "svelte";
  import { onDestroy, onMount } from "svelte";
  import { auth } from "../auth";
  import {
    getVisibleNavSections,
    isAdmin,
    requiresAdminRoute,
    type NavSection,
  } from "../control-panel.ts";
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
  let profile = $state<AuthSessionsMeOutput["user"] | null>(null);
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

  async function signOut(): Promise<void> {
    await auth.signOut((input) => logoutAuthenticatedUser(trellis, input));
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
