<script lang="ts">
  import { browser } from "$app/environment";
  import { replaceState } from "$app/navigation";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import {
    type AuthState,
    type NatsState,
    type TrellisClientContract,
    createAuthState,
    createNatsState,
    createTrellisState,
  } from "@qlever-llc/trellis-svelte";
  import { portalApp } from "../../../../../contracts/portal_app.ts";
  import { APP_CONFIG } from "../../../../lib/config";
  import { errorMessage } from "../../../../lib/format";

  async function createPortalTrellisState(
    authState: AuthState,
    natsState: NatsState,
  ): Promise<{
    trellis: {
      requestOrThrow: (method: string, input: unknown) => Promise<unknown>;
    };
  }> {
    const contract: TrellisClientContract = portalApp;
    const trellisState = await createTrellisState(authState, natsState, {
      contract,
    });
    return {
      trellis: {
        requestOrThrow: trellisState.trellis.requestOrThrow.bind(trellisState.trellis),
      },
    };
  }

  type ActivatedWorkloadResult = {
    status: "activated";
    instanceId: string;
    profileId: string;
    activatedAt: string;
    confirmationCode?: string;
  };

  type PendingReviewWorkloadResult = {
    status: "pending_review";
    reviewId: string;
    instanceId: string;
    profileId: string;
    requestedAt: string;
  };

  type RejectedWorkloadResult = {
    status: "rejected";
    reason?: string;
  };

  type WorkloadActivationResult =
    | ActivatedWorkloadResult
    | PendingReviewWorkloadResult
    | RejectedWorkloadResult;

  type StartPortalActivation = (handoffId: string) => Promise<WorkloadActivationResult>;
  type GetPortalActivationStatus = (handoffId: string) => Promise<WorkloadActivationResult>;

  type ActivationView =
    | { mode: "sign_in_required"; handoffId: string; profileId?: string }
    | { mode: "ready"; handoffId: string; profileId?: string }
    | {
      mode: "pending_review";
      handoffId: string;
      instanceId: string;
      profileId: string;
      reviewId: string;
      requestedAt: string;
    }
    | {
      mode: "activated";
      handoffId: string;
      instanceId: string;
      profileId: string;
      activatedAt: string;
      confirmationCode?: string;
    }
    | { mode: "rejected"; handoffId: string; reason?: string }
    | { mode: "expired"; handoffId: string; reason: string }
    | { mode: "invalid_handoff"; reason: string; handoffId?: string };

  const authState = createAuthState({
    authUrl: APP_CONFIG.authUrl,
    loginPath: "/_trellis/portal/login",
    contract: portalApp,
  });

  let loading = $state(true);
  let requestPending = $state(false);
  let authError = $state<string | null>(null);
  let view = $state<ActivationView | null>(null);
  let handoffId = $state<string | null>(null);
  let profileHint = $state<string | null>(null);
  let startPortalActivation: StartPortalActivation | null = null;
  let getPortalActivationStatus: GetPortalActivationStatus | null = null;

  const ACTIVATION_STATUS_POLL_INTERVAL_MS = 2_000;

  let pollingRunId = 0;
  let mounted = false;

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  function hasStringField(record: Record<string, unknown>, key: string): boolean {
    return typeof record[key] === "string";
  }

  function hasOptionalStringField(record: Record<string, unknown>, key: string): boolean {
    return !(key in record) || typeof record[key] === "string";
  }

  function currentPath(): string {
    return `${window.location.pathname}${window.location.search}`;
  }

  function getErrorContext(error: unknown): Record<string, unknown> | null {
    if (!isRecord(error)) return null;
    if (!("context" in error)) return null;
    const context = Reflect.get(error, "context");
    return isRecord(context) ? context : null;
  }

  function isActivatedWorkloadResult(value: unknown): value is ActivatedWorkloadResult {
    if (!isRecord(value) || value.status !== "activated") return false;
    return hasStringField(value, "instanceId")
      && hasStringField(value, "profileId")
      && hasStringField(value, "activatedAt")
      && hasOptionalStringField(value, "confirmationCode");
  }

  function isPendingReviewWorkloadResult(value: unknown): value is PendingReviewWorkloadResult {
    if (!isRecord(value) || value.status !== "pending_review") return false;
    return hasStringField(value, "reviewId")
      && hasStringField(value, "instanceId")
      && hasStringField(value, "profileId")
      && hasStringField(value, "requestedAt");
  }

  function isRejectedWorkloadResult(value: unknown): value is RejectedWorkloadResult {
    if (!isRecord(value) || value.status !== "rejected") return false;
    return hasOptionalStringField(value, "reason");
  }

  function isWorkloadActivationResult(value: unknown): value is WorkloadActivationResult {
    return isActivatedWorkloadResult(value)
      || isPendingReviewWorkloadResult(value)
      || isRejectedWorkloadResult(value);
  }

  function mapRejectedActivation(nextHandoffId: string, reason?: string): ActivationView {
    if (reason === "workload_handoff_expired") {
      return {
        mode: "expired",
        handoffId: nextHandoffId,
        reason: "The activation request expired. Start again from the auth service.",
      };
    }

    if (reason === "activation_not_started") {
      return createReadyView(nextHandoffId);
    }

    if (reason === "workload_activation_revoked") {
      return {
        mode: "rejected",
        handoffId: nextHandoffId,
        reason: "The activation request was revoked.",
      };
    }

    return {
      mode: "rejected",
      handoffId: nextHandoffId,
      ...(reason ? { reason } : {}),
    };
  }

  function mapActivationResult(nextHandoffId: string, result: WorkloadActivationResult): ActivationView {
    if (result.status === "activated") {
      return {
        mode: "activated",
        handoffId: nextHandoffId,
        instanceId: result.instanceId,
        profileId: result.profileId,
        activatedAt: result.activatedAt,
        ...(result.confirmationCode ? { confirmationCode: result.confirmationCode } : {}),
      };
    }

    if (result.status === "pending_review") {
      return {
        mode: "pending_review",
        handoffId: nextHandoffId,
        instanceId: result.instanceId,
        profileId: result.profileId,
        reviewId: result.reviewId,
        requestedAt: result.requestedAt,
      };
    }

    return mapRejectedActivation(nextHandoffId, result.reason);
  }

  function createReadyView(nextHandoffId: string): ActivationView {
    return {
      mode: "ready",
      handoffId: nextHandoffId,
      ...(profileHint ? { profileId: profileHint } : {}),
    };
  }

  function createSignInRequiredView(nextHandoffId: string): ActivationView {
    return {
      mode: "sign_in_required",
      handoffId: nextHandoffId,
      ...(profileHint ? { profileId: profileHint } : {}),
    };
  }

  function mapActivationFailure(nextHandoffId: string, error: unknown): ActivationView | null {
    const message = errorMessage(error);
    const context = getErrorContext(error);
    const reason = typeof context?.reason === "string" ? context.reason : undefined;

    if (message.includes("workload_handoff_not_found")) {
      return { mode: "invalid_handoff", handoffId: nextHandoffId, reason: "This activation link is no longer valid." };
    }

    if (message.includes("workload_handoff_expired")) {
      return { mode: "expired", handoffId: nextHandoffId, reason: "The activation request expired. Start again from the auth service." };
    }

    if (message.includes("workload_activation_revoked")) {
      return { mode: "rejected", handoffId: nextHandoffId, reason };
    }

    return null;
  }

  function cleanupCallbackUrl(): void {
    const nextUrl = new URL(window.location.href);
    if (nextUrl.searchParams.has("flowId") || nextUrl.searchParams.has("authError")) {
      nextUrl.searchParams.delete("flowId");
      nextUrl.searchParams.delete("authError");
      replaceState(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`, page.state);
    }
  }

  async function initializeBrowserState(): Promise<void> {
    await authState.init();
    const bindResult = await authState.handleCallback();
    if (bindResult) {
      cleanupCallbackUrl();
    }

    if (bindResult && bindResult.status !== "bound") {
      if (bindResult.status === "approval_denied") {
        authError = "Portal access was denied.";
      } else if (bindResult.status === "insufficient_capabilities") {
        authError = `Missing capabilities: ${bindResult.missingCapabilities.join(", ")}`;
      } else if (bindResult.status === "approval_required") {
        authError = "Approval is still pending.";
      } else {
        authError = bindResult.message;
      }
      return;
    }

    if (!authState.isAuthenticated) {
      return;
    }

    const natsState = await createNatsState(authState, {
      onAuthRequired: () => {
        authError = "Your portal session expired. Please sign in again.";
        if (handoffId) {
          view = createSignInRequiredView(handoffId);
        }
      },
      onError: (error) => {
        authError = error.message;
      },
    });

    const trellisState = await createPortalTrellisState(authState, natsState);
    const requestOrThrow: (
      method: string,
      input: unknown,
    ) => Promise<unknown> = trellisState.trellis.requestOrThrow.bind(trellisState.trellis);

    startPortalActivation = async (nextHandoffId: string) => {
      const result = await requestOrThrow(
        "Auth.ActivateWorkload",
        { handoffId: nextHandoffId },
      );
      if (!isWorkloadActivationResult(result)) {
        throw new Error("Invalid workload activation response.");
      }
      return result;
    };

    getPortalActivationStatus = async (nextHandoffId: string) => {
      const requestOrThrow: (
        method: string,
        input: unknown,
      ) => Promise<unknown> = trellisState.trellis.requestOrThrow.bind(trellisState.trellis);
      const result = await requestOrThrow(
        "Auth.GetWorkloadActivationStatus",
        { handoffId: nextHandoffId },
      );
      if (!isWorkloadActivationResult(result)) {
        throw new Error("Invalid workload activation status response.");
      }
      return result;
    };
  }

  function cancelPolling(): void {
    pollingRunId += 1;
  }

  function isPollingActive(runId: number): boolean {
    return mounted && pollingRunId === runId;
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function pollActivationStatus(nextHandoffId: string, runId: number): Promise<void> {
    if (!getPortalActivationStatus) return;

    while (isPollingActive(runId)) {
      await sleep(ACTIVATION_STATUS_POLL_INTERVAL_MS);
      if (!isPollingActive(runId)) return;

      try {
        const result = await getPortalActivationStatus(nextHandoffId);
        if (!isPollingActive(runId)) return;

        view = mapActivationResult(nextHandoffId, result);
        if (result.status !== "pending_review") {
          return;
        }
      } catch (nextError) {
        if (!isPollingActive(runId)) return;

        const nextView = mapActivationFailure(nextHandoffId, nextError);
        if (nextView) {
          view = nextView;
        } else {
          view = createReadyView(nextHandoffId);
          authError = errorMessage(nextError);
        }
        return;
      }
    }
  }

  async function requestActivation(): Promise<void> {
    if (!handoffId || !startPortalActivation) return;

    cancelPolling();
    requestPending = true;
    authError = null;

    try {
      const output = await startPortalActivation(handoffId);
      view = mapActivationResult(handoffId, output);

      if (output.status === "pending_review") {
        const runId = pollingRunId;
        await pollActivationStatus(handoffId, runId);
      }
    } catch (nextError) {
      const nextView = mapActivationFailure(handoffId, nextError);
      if (nextView) {
        view = nextView;
      } else {
        view = createReadyView(handoffId);
        authError = errorMessage(nextError);
      }
    } finally {
      requestPending = false;
    }
  }

  async function signIn(): Promise<void> {
    authError = null;
    await authState.signIn({
      redirectTo: currentPath(),
    });
  }

  onMount(() => {
    if (!browser) return;

    mounted = true;
    const cleanup = () => {
      mounted = false;
      cancelPolling();
    };

    handoffId = page.url.searchParams.get("handoffId");
    profileHint = page.url.searchParams.get("profileId");
    if (!handoffId) {
      view = { mode: "invalid_handoff", reason: "Missing handoff id." };
      loading = false;
      return cleanup;
    }

    void (async () => {
      try {
        await initializeBrowserState();
        if (!view) {
          view = authState.isAuthenticated
            ? createReadyView(handoffId)
            : createSignInRequiredView(handoffId);
        }
      } catch (nextError) {
        authError = errorMessage(nextError);
        view = createSignInRequiredView(handoffId);
      } finally {
        loading = false;
      }
    })();

    return cleanup;
  });
</script>

<svelte:head>
  <title>Approve Device · Trellis</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10" data-theme="portal">
  <div class="flex items-center gap-2">
    <span class="inline-block h-2 w-2 rounded-full bg-primary"></span>
    <span class="text-sm font-semibold text-base-content/55">Trellis Auth</span>
  </div>

  <div class="card w-full max-w-md border border-base-300 bg-base-100 shadow-md">
    <div class="card-body gap-5 p-6">
      {#if loading}
        <div class="flex items-center justify-center py-4">
          <span class="loading loading-ring loading-md"></span>
        </div>
      {:else}
        <div>
          <h1 class="text-lg font-bold text-base-content">
            {#if view?.mode === "sign_in_required"}
              Sign in to continue
            {:else if view?.mode === "ready"}
              Approve this device
            {:else if view?.mode === "pending_review"}
              Approval pending
            {:else if view?.mode === "activated"}
              Device approved
            {:else if view?.mode === "rejected"}
              Request denied
            {:else if view?.mode === "expired"}
              Link expired
            {:else}
              Invalid link
            {/if}
          </h1>

          <p class="mt-1 text-sm text-base-content/60">
            {#if view?.mode === "sign_in_required"}
              Sign in to approve this device.
            {:else if view?.mode === "ready"}
              {#if view.profileId}
                Approve this device for this profile.
              {:else}
                You are signed in and can approve this device now.
              {/if}
            {:else if view?.mode === "pending_review"}
              We have sent your approval request. Keep this page open while we check for a decision.
            {:else if view?.mode === "activated"}
              This device has been approved and can finish setup.
            {:else if view?.mode === "rejected"}
              This device was not approved.
            {:else if view?.mode === "expired"}
              This approval link has expired. Start again from your app.
            {:else}
              This approval link is missing or no longer valid.
            {/if}
          </p>
        </div>

        {#if view?.mode === "sign_in_required"}
          {#if view.profileId}
            <div class="rounded-box border border-base-300 bg-base-200/40 p-4">
              <p class="text-xs font-bold uppercase tracking-widest text-base-content/45">Profile</p>
              <p class="mono mt-2 break-all text-sm text-base-content">{view.profileId}</p>
            </div>
          {/if}

          <button class="btn btn-primary btn-block" onclick={() => void signIn()}>Continue to sign in</button>
        {:else if view?.mode === "ready"}
          {#if view.profileId}
            <div class="rounded-box border border-base-300 bg-base-200/40 p-4">
              <p class="text-xs font-bold uppercase tracking-widest text-base-content/45">Approving for</p>
              <p class="mono mt-2 break-all text-sm text-base-content">{view.profileId}</p>
            </div>
          {/if}

          <button class="btn btn-primary btn-block" disabled={requestPending} onclick={() => void requestActivation()}>
            {#if requestPending}
              <span class="loading loading-spinner loading-sm"></span>
              Approving...
            {:else}
              Approve device
            {/if}
          </button>
        {:else if view?.mode === "pending_review"}
          <div class="alert alert-info text-sm">
            <span>Waiting for a decision. This page checks automatically.</span>
          </div>

          <div class="rounded-box border border-base-300 bg-base-100 p-4">
            <p class="text-xs font-bold uppercase tracking-widest text-base-content/45">Request details</p>
            <p class="mono mt-2 break-all text-sm text-base-content">{view.profileId}</p>
            <p class="mt-1 text-xs text-base-content/55">Device <span class="mono break-all">{view.instanceId}</span></p>
          </div>

          <div class="flex items-center justify-center py-1">
            <span class="loading loading-spinner loading-md"></span>
          </div>
        {:else if view?.mode === "activated"}
          <div class="alert alert-success text-sm">
            <span>Approval complete.</span>
          </div>

          {#if view.confirmationCode}
            <div class="rounded-box border border-success/30 bg-success/10 p-5 text-center">
              <p class="text-xs font-bold uppercase tracking-[0.2em] text-base-content/45">Confirmation code</p>
              <p class="mono mt-3 break-all text-3xl font-semibold tracking-[0.3em] text-base-content sm:text-4xl">{view.confirmationCode}</p>
            </div>
          {/if}

          <div class="rounded-box border border-base-300 bg-base-100 p-4">
            <p class="text-xs font-bold uppercase tracking-widest text-base-content/45">Profile</p>
            <p class="mono mt-2 break-all text-sm text-base-content">{view.profileId}</p>
            <p class="mt-4 text-xs font-bold uppercase tracking-widest text-base-content/35">Device id</p>
            <p class="mono mt-1 break-all text-xs text-base-content/50">{view.instanceId}</p>
          </div>
        {:else if view?.mode === "rejected"}
          <div class="alert alert-error text-sm">
            <span>{view.reason ?? "This approval request was denied."}</span>
          </div>
          <button class="btn btn-outline btn-block" onclick={() => void signIn()}>Sign in again</button>
        {:else if view?.mode === "expired"}
          <div class="alert alert-error text-sm">
            <span>{view.reason}</span>
          </div>
          <a class="btn btn-outline btn-block" href={APP_CONFIG.authUrl}>Return to app</a>
        {:else if view?.mode === "invalid_handoff"}
          <div class="alert alert-error text-sm">
            <span>{view.reason}</span>
          </div>
          <a class="btn btn-outline btn-block" href={APP_CONFIG.authUrl}>Return to app</a>
        {/if}
      {/if}

      {#if authError}
        <div class="alert alert-error text-sm">
          <span>{authError}</span>
        </div>
      {/if}
    </div>
  </div>
</div>
