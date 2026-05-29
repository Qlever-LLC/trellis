<script lang="ts">
  import { isErr, type BaseError, type Result } from "@qlever-llc/result";
  import type { DeploymentAuthorityKind, DeploymentAuthorityPlan } from "@qlever-llc/trellis/auth";
  import { goto } from "$app/navigation";
  import { base, resolve } from "$app/paths";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import DataTable from "$lib/components/DataTable.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import PageToolbar from "$lib/components/PageToolbar.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import {
    authorityPlanChangeState,
    deltaCapabilityRows,
    deltaContractRows,
    deltaResourceRows,
    deltaSurfaceRows,
  } from "$lib/authority_console";
  import { errorMessage, formatDate } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type PlanState = "pending" | "accepted" | "rejected" | "expired";
  type AuthorityKind = DeploymentAuthorityKind;
  type RpcTakeable<T> = { take(): Promise<T | Result<never, BaseError>> };
  type AuthorityPlansRequest = {
    (method: "Auth.DeploymentAuthority.Plans.Get", input: { planId: string }): RpcTakeable<{ plan: DeploymentAuthorityPlan }>;
    (method: "Auth.DeploymentAuthority.Get", input: { deploymentId: string }): RpcTakeable<{ authority: { kind: AuthorityKind } }>;
    (method: "Auth.DeploymentAuthority.AcceptUpdate", input: { planId: string; expectedDesiredVersion?: string }): RpcTakeable<unknown>;
    (method: "Auth.DeploymentAuthority.AcceptMigration", input: { planId: string; expectedDesiredVersion?: string; acknowledgement: string }): RpcTakeable<unknown>;
    (method: "Auth.DeploymentAuthority.Reject", input: { planId: string; reason?: string }): RpcTakeable<unknown>;
  };

  const trellis = getTrellis();
  const request = trellis.request.bind(trellis) as AuthorityPlansRequest;
  const planId = $derived(decodeURIComponent(page.url.pathname.split("/").filter(Boolean).at(-1) ?? ""));
  const plansHref = `${base}/admin/authority/plans`;

  let loading = $state(true);
  let acting = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let plan = $state.raw<DeploymentAuthorityPlan | null>(null);
  let authorityKind = $state<AuthorityKind | null>(null);
  let acknowledgement = $state("");
  let rejectReason = $state("");

  const planStatus = $derived(plan ? planState(plan) : "pending");
  const pending = $derived(planStatus === "pending");
  const requestedState = $derived(plan ? authorityPlanChangeState(plan) : null);
  const contractRows = $derived(requestedState ? deltaContractRows(requestedState) : []);
  const surfaceRows = $derived(requestedState ? deltaSurfaceRows(requestedState) : []);
  const resourceRows = $derived(requestedState ? deltaResourceRows(requestedState) : []);
  const capabilityRows = $derived(requestedState ? deltaCapabilityRows(requestedState) : []);
  const migrationAcknowledged = $derived(acknowledgement.trim() === "I understand");
  const rejectReady = $derived(rejectReason.trim().length > 0);

  function planState(value: DeploymentAuthorityPlan): PlanState {
    if ("state" in value && isPlanState(value.state)) return value.state;
    return "pending";
  }

  function isPlanState(value: unknown): value is PlanState {
    return value === "pending" || value === "accepted" || value === "rejected" || value === "expired";
  }

  function decisionField(value: DeploymentAuthorityPlan, key: "decisionAt" | "decisionReason"): string | null {
    if (!(key in value)) return null;
    const field = value[key];
    return typeof field === "string" && field.length > 0 ? field : null;
  }

  function decisionBy(value: DeploymentAuthorityPlan): string {
    if (!("decisionBy" in value) || value.decisionBy === null || typeof value.decisionBy !== "object") return "—";
    const actor = value.decisionBy;
    for (const key of ["email", "userId", "id", "subject"]) {
      const field = actor[key];
      if (typeof field === "string" && field.length > 0) return field;
    }
    return "recorded";
  }

  function statusVariant(value: PlanState): "healthy" | "degraded" | "unhealthy" | "offline" {
    if (value === "accepted") return "healthy";
    if (value === "pending") return "degraded";
    if (value === "rejected") return "unhealthy";
    return "offline";
  }

  async function load(clearNotice = true) {
    loading = true;
    error = null;
    if (clearNotice) notice = null;
    try {
      const response = await request("Auth.DeploymentAuthority.Plans.Get", { planId }).take();
      if (isErr(response)) { error = errorMessage(response); return; }
      plan = response.plan;
      const authorityResponse = await request("Auth.DeploymentAuthority.Get", { deploymentId: response.plan.deploymentId }).take();
      authorityKind = isErr(authorityResponse) ? null : authorityResponse.authority.kind;
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      loading = false;
    }
  }

  async function acceptUpdate() {
    const currentPlan = plan;
    if (!currentPlan || currentPlan.classification !== "update") return;
    await runDecision(
      () => request("Auth.DeploymentAuthority.AcceptUpdate", { planId: currentPlan.planId }).take(),
      "Update plan accepted.",
    );
  }

  async function acceptMigration() {
    const currentPlan = plan;
    if (!currentPlan || currentPlan.classification !== "migration" || !migrationAcknowledged) return;
    await runDecision(
      () => request("Auth.DeploymentAuthority.AcceptMigration", { planId: currentPlan.planId, acknowledgement: acknowledgement.trim() }).take(),
      "Migration plan accepted.",
    );
  }

  async function rejectPlan() {
    const currentPlan = plan;
    if (!currentPlan || !rejectReady) return;
    await runDecision(
      () => request("Auth.DeploymentAuthority.Reject", { planId: currentPlan.planId, reason: rejectReason.trim() }).take(),
      "Plan rejected.",
    );
  }

  function openDeployment(deploymentId: string) {
    if (authorityKind === "service") {
      void goto(resolve("/(app)/admin/services/[deploymentId]", { deploymentId }));
      return;
    }
    if (authorityKind === "device") {
      void goto(resolve("/admin/devices"));
      return;
    }
    void goto(plansHref);
  }

  async function runDecision(action: () => Promise<unknown | Result<never, BaseError>>, message: string) {
    acting = true;
    error = null;
    notice = null;
    try {
      const response = await action();
      if (isErr(response)) { error = errorMessage(response); return; }
      notice = message;
      await load(false);
    } catch (cause) {
      error = errorMessage(cause);
    } finally {
      acting = false;
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section class="space-y-4">
  <PageToolbar title="Authority plan" description="Review what deployment authority changes if this plan is accepted.">
    {#snippet actions()}
      <a class="btn btn-ghost btn-sm" href={plansHref}>Back to plans</a>
      <button class="btn btn-ghost btn-sm" onclick={() => void load()} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}<Notice variant="error">{error}</Notice>{/if}
  {#if notice}<Notice variant="success">{notice}</Notice>{/if}

  {#if loading}
    <Panel><LoadingState label="Loading authority plan" /></Panel>
  {:else if !plan}
    <Panel><EmptyState title="Authority plan unavailable" description="The selected authority plan could not be loaded." /></Panel>
  {:else}
    <Panel>
      <div class="flex flex-wrap items-start justify-between gap-3 border-b border-base-300 pb-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="trellis-identifier truncate text-lg font-semibold">{plan.planId}</h2>
            <StatusBadge label={planStatus} status={statusVariant(planStatus)} />
            <span class="badge badge-outline badge-sm">{plan.classification}</span>
            {#if authorityKind}<span class="badge badge-outline badge-sm">{authorityKind}</span>{/if}
          </div>
          <div class="mt-1 text-sm text-base-content/60">
            Deployment <span class="trellis-identifier">{plan.deploymentId}</span> · contract <span class="trellis-identifier">{plan.proposal.contractId}</span> · created {formatDate(plan.createdAt)}
          </div>
        </div>
        <button class="btn btn-outline btn-sm" onclick={() => plan && openDeployment(plan.deploymentId)}>Open deployment</button>
      </div>

      {#if plan.warnings.length > 0}
        <Notice variant="warning" class="mt-3 items-start">
          <div><div class="font-medium">Plan warnings</div><ul class="mt-1 list-disc pl-4 text-sm">{#each plan.warnings as warning (warning)}<li>{warning}</li>{/each}</ul></div>
        </Notice>
      {/if}

      <div class="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div class="space-y-4">
          <Panel title="Contracts" class="min-w-0">
            <DataTable><thead><tr><th>Change</th><th>Contract</th><th>Availability</th></tr></thead><tbody>{#each contractRows as row (row.id)}<tr><td><span class="badge badge-outline badge-xs">Add</span></td><td class="trellis-identifier">{row.contractId}</td><td><span class="badge badge-outline badge-xs">{row.availability}</span></td></tr>{:else}<tr><td colspan="3"><EmptyState title="No contract changes" description="This plan does not request contract authority changes." /></td></tr>{/each}</tbody></DataTable>
          </Panel>

          <Panel title="Surfaces" class="min-w-0">
            <DataTable><thead><tr><th>Change</th><th>Surface</th><th>Kind</th><th>Action</th><th>Availability</th></tr></thead><tbody>{#each surfaceRows as row (row.id)}<tr><td><span class="badge badge-outline badge-xs">Add</span></td><td><div class="trellis-identifier">{row.name}</div><div class="trellis-identifier text-xs text-base-content/50">{row.contractId}</div></td><td>{row.kind}</td><td>{row.action}</td><td><span class="badge badge-outline badge-xs">{row.availability}</span></td></tr>{:else}<tr><td colspan="5"><EmptyState title="No surface changes" description="This plan does not request callable, event, operation, or feed surface changes." /></td></tr>{/each}</tbody></DataTable>
          </Panel>

          <div class="grid gap-4 lg:grid-cols-2">
            <Panel title="Resources" class="min-w-0">
              <DataTable><thead><tr><th>Change</th><th>Resource</th><th>Availability</th></tr></thead><tbody>{#each resourceRows as row (row.id)}<tr><td><span class="badge badge-outline badge-xs">Add</span></td><td><div class="trellis-identifier">{row.alias}</div><div class="text-xs text-base-content/60">{row.kind}</div></td><td><span class="badge badge-outline badge-xs">{row.availability}</span></td></tr>{:else}<tr><td colspan="3"><EmptyState title="No resource changes" description="This plan does not request runtime resources." /></td></tr>{/each}</tbody></DataTable>
            </Panel>
            <Panel title="Capabilities" class="min-w-0">
              <DataTable><thead><tr><th>Change</th><th>Capability</th><th>Availability</th></tr></thead><tbody>{#each capabilityRows as row (row.id)}<tr><td><span class="badge badge-outline badge-xs">Add</span></td><td class="trellis-identifier">{row.capability}</td><td><span class="badge badge-outline badge-xs">{row.availability}</span></td></tr>{:else}<tr><td colspan="3"><EmptyState title="No capability changes" description="This plan does not request capability grants." /></td></tr>{/each}</tbody></DataTable>
            </Panel>
          </div>
        </div>

        <div class="space-y-4">
          <Panel title={pending ? "Decision" : "Decision record"}>
            {#if pending}
              {#if plan.classification === "migration"}
                <Notice variant="warning" class="mb-3">Migration plans can change existing authority semantics. Type <span class="trellis-identifier font-semibold">I understand</span> to enable acceptance.</Notice>
                <label class="form-control"><span class="label py-1 text-xs text-base-content/60">Acknowledgement</span><input class="input input-bordered input-sm" bind:value={acknowledgement} placeholder="I understand" /></label>
                <button class="btn btn-warning btn-outline btn-sm mt-3 w-full" onclick={acceptMigration} disabled={acting || !migrationAcknowledged}>Accept migration</button>
              {:else}
                <button class="btn btn-warning btn-outline btn-sm w-full" onclick={acceptUpdate} disabled={acting}>Accept update</button>
              {/if}
              <div class="divider my-3">Reject</div>
              <label class="form-control"><span class="label py-1 text-xs text-base-content/60">Reason required</span><textarea class="textarea textarea-bordered min-h-24" bind:value={rejectReason} placeholder="Why is this plan being rejected?"></textarea></label>
              <button class="btn btn-error btn-outline btn-sm mt-3 w-full" onclick={rejectPlan} disabled={acting || !rejectReady}>Reject plan</button>
            {:else}
              <dl class="space-y-2 text-sm">
                <div class="flex justify-between gap-3"><dt class="text-base-content/60">State</dt><dd><StatusBadge label={planStatus} status={statusVariant(planStatus)} /></dd></div>
                <div class="flex justify-between gap-3"><dt class="text-base-content/60">Decision at</dt><dd>{decisionField(plan, "decisionAt") ? formatDate(decisionField(plan, "decisionAt") ?? "") : "—"}</dd></div>
                <div class="flex justify-between gap-3"><dt class="text-base-content/60">Decision by</dt><dd class="trellis-identifier text-xs">{decisionBy(plan)}</dd></div>
                <div><dt class="text-base-content/60">Reason</dt><dd class="mt-1 text-base-content/80">{decisionField(plan, "decisionReason") ?? "—"}</dd></div>
              </dl>
            {/if}
          </Panel>
        </div>
      </div>
    </Panel>
  {/if}
</section>
