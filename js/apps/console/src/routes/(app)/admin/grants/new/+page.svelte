<script lang="ts">
  import { isErr, type AsyncResult, type BaseError } from "@qlever-llc/result";
  import type { DeploymentEnvelope, DeploymentGrantOverride } from "@qlever-llc/trellis/auth";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";
  import ChoiceRow from "$lib/components/ChoiceRow.svelte";
  import LoadingState from "$lib/components/LoadingState.svelte";
  import Notice from "$lib/components/Notice.svelte";
  import Panel from "$lib/components/Panel.svelte";
  import SelectionGroup from "$lib/components/SelectionGroup.svelte";
  import SelectionSectionHeader from "$lib/components/SelectionSectionHeader.svelte";
  import { errorMessage } from "$lib/format";
  import { getTrellis } from "$lib/trellis";

  type GrantIdentityKind = "web" | "session";
  type ListPageInput = {
    offset?: number;
    limit: number;
  };
  type CapabilityView = {
    key: string;
    displayName: string;
    description: string;
    consequence?: string;
    source: "contract" | "platform";
    contractId?: string;
    contractDigest?: string;
    contractDisplayName?: string;
  };
  type CapabilityGroupView = {
    groupKey: string;
    displayName: string;
    description: string;
    capabilities: string[];
    includedGroups: string[];
    createdAt: string;
    updatedAt: string;
  };
  type CapabilityListOutput = {
    entries: CapabilityView[];
  };
  type CapabilityGroupListOutput = {
    entries: CapabilityGroupView[];
  };
  type EnvelopeListOutput = {
    entries: DeploymentEnvelope[];
  };
  type EnvelopeGetOutput = {
    grantOverrides: DeploymentGrantOverride[];
  };
  type EnvelopeGetInput = {
    deploymentId: string;
  };
  type GrantOverrideMutationInput = {
    deploymentId: string;
    overrides: DeploymentGrantOverride[];
  };
  type GrantOverrideMutationOutput = {
    grantOverrides: DeploymentGrantOverride[];
  };
  type AuthRpcClient = {
    request(subject: "Auth.Envelopes.List", input: ListPageInput): AsyncResult<EnvelopeListOutput, BaseError>;
    request(subject: "Auth.Envelopes.Get", input: EnvelopeGetInput): AsyncResult<EnvelopeGetOutput, BaseError>;
    request(subject: "Auth.Capabilities.List", input: ListPageInput): AsyncResult<CapabilityListOutput, BaseError>;
    request(subject: "Auth.CapabilityGroups.List", input: ListPageInput): AsyncResult<CapabilityGroupListOutput, BaseError>;
    request(subject: "Auth.Envelopes.GrantOverrides.Put", input: GrantOverrideMutationInput): AsyncResult<GrantOverrideMutationOutput, BaseError>;
  };
  type CapabilitySection = {
    key: string;
    title: string;
    subtitle: string | null;
    capabilities: CapabilityView[];
  };

  const trellis = getTrellis();
  const authRpc = trellis as AuthRpcClient;
  const grantIdentityKinds: GrantIdentityKind[] = ["web", "session"];

  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let deployments = $state.raw<DeploymentEnvelope[]>([]);
  let existingOverrides = $state.raw<DeploymentGrantOverride[]>([]);
  let identityKind = $state<GrantIdentityKind>("web");
  let contractId = $state("");
  let origin = $state("");
  let sessionPublicKey = $state("");
  let selectedCapabilities = $state<string[]>([]);
  let selectedCapabilityGroups = $state<string[]>([]);
  let capabilities = $state.raw<CapabilityView[]>([]);
  let capabilityGroups = $state.raw<CapabilityGroupView[]>([]);

  const busy = $derived(loading || saving);
  const deploymentOptions = $derived(deployments.toSorted((left, right) => left.deploymentId.localeCompare(right.deploymentId)));
  const storageDeployment = $derived(deploymentOptions.find((deployment) => !deployment.disabled) ?? null);
  const storageDeploymentId = $derived(storageDeployment?.deploymentId ?? "");
  const enabledDeploymentIds = $derived(new Set(deployments.filter((deployment) => !deployment.disabled).map((deployment) => deployment.deploymentId)));
  const requiredIdentityValue = $derived(identityKind === "web" ? origin.trim() : sessionPublicKey.trim());
  const sortedCapabilityGroups = $derived(capabilityGroups.slice().sort((left, right) => {
    if ((left.groupKey === "admin") !== (right.groupKey === "admin")) return left.groupKey === "admin" ? -1 : 1;
    return left.groupKey.localeCompare(right.groupKey);
  }));
  const pendingDirectCapabilityKeys = $derived(uniqueGrantReferences(selectedCapabilities));
  const pendingCapabilityGroupKeys = $derived(uniqueGrantReferences(selectedCapabilityGroups));
  const pendingGrantReferenceCount = $derived(pendingDirectCapabilityKeys.length + pendingCapabilityGroupKeys.length);
  const capabilitySections = $derived.by(() => {
    const sections: CapabilitySection[] = [];
    for (const capability of capabilities) {
      const key = capabilitySectionKey(capability);
      const existing = sections.find((section) => section.key === key);
      if (existing) {
        existing.capabilities.push(capability);
      } else {
        sections.push({
          key,
          title: capabilitySectionTitle(capability),
          subtitle: capabilitySectionSubtitle(capability),
          capabilities: [capability],
        });
      }
    }
    return sections
      .map((section) => ({
        ...section,
        capabilities: section.capabilities.slice().sort((left, right) =>
          localCapabilityKey(left.key).localeCompare(localCapabilityKey(right.key))
        ),
      }))
      .sort((left, right) => {
        if (left.key === "platform") return -1;
        if (right.key === "platform") return 1;
        return left.title.localeCompare(right.title) || left.key.localeCompare(right.key);
      });
  });

  function trimmedRequired(value: string): string | null {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function capabilitySectionKey(capability: CapabilityView): string {
    if (capability.source === "platform") return "platform";
    return capability.contractId ?? capability.contractDisplayName ?? "contract";
  }

  function capabilitySectionTitle(capability: CapabilityView): string {
    if (capability.source === "platform") return "Platform";
    return capability.contractDisplayName ?? capability.contractId ?? "Contract";
  }

  function capabilitySectionSubtitle(capability: CapabilityView): string | null {
    if (capability.source === "platform") return null;
    return capability.contractId ?? null;
  }

  function localCapabilityKey(key: string): string {
    return key.includes("::") ? key.split("::").slice(1).join("::") : key;
  }

  function uniqueGrantReferences(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
  }

  function grantOverrideReference(override: DeploymentGrantOverride): string {
    return override.grantKind === "capability" ? override.capability : override.capabilityGroupKey;
  }

  function grantIdentityKey(override: DeploymentGrantOverride): string {
    return [
      override.identityKind,
      override.grantKind,
      override.contractId,
      override.origin ?? "-",
      override.sessionPublicKey ?? "-",
      grantOverrideReference(override),
    ].join("|");
  }

  function sameGrantIdentity(left: DeploymentGrantOverride, right: DeploymentGrantOverride): boolean {
    return grantIdentityKey(left) === grantIdentityKey(right);
  }

  function cleanGrantOverride(override: DeploymentGrantOverride): DeploymentGrantOverride {
    if (override.identityKind === "web") {
      if (override.grantKind === "capability") {
        return {
          deploymentId: override.deploymentId,
          identityKind: "web",
          grantKind: "capability",
          contractId: override.contractId,
          origin: override.origin,
          sessionPublicKey: null,
          capability: override.capability,
          capabilityGroupKey: null,
        };
      }
      return {
        deploymentId: override.deploymentId,
        identityKind: "web",
        grantKind: "capability-group",
        contractId: override.contractId,
        origin: override.origin,
        sessionPublicKey: null,
        capability: null,
        capabilityGroupKey: override.capabilityGroupKey,
      };
    }
    if (override.grantKind === "capability") {
      return {
        deploymentId: override.deploymentId,
        identityKind: "session",
        grantKind: "capability",
        contractId: override.contractId,
        origin: null,
        sessionPublicKey: override.sessionPublicKey,
        capability: override.capability,
        capabilityGroupKey: null,
      };
    }
    return {
      deploymentId: override.deploymentId,
      identityKind: "session",
      grantKind: "capability-group",
      contractId: override.contractId,
      origin: null,
      sessionPublicKey: override.sessionPublicKey,
      capability: null,
      capabilityGroupKey: override.capabilityGroupKey,
    };
  }

  function buildOverrides(): DeploymentGrantOverride[] {
    const grantContractId = trimmedRequired(contractId);
    const grantOrigin = trimmedRequired(origin);
    const grantSessionPublicKey = trimmedRequired(sessionPublicKey);
    if (!storageDeploymentId || pendingGrantReferenceCount === 0 || !grantContractId) return [];
    if (identityKind === "web") {
      if (!grantOrigin) return [];
      return [
        ...pendingDirectCapabilityKeys.map((grantCapability): DeploymentGrantOverride => ({
          deploymentId: storageDeploymentId,
          identityKind: "web",
          grantKind: "capability",
          contractId: grantContractId,
          origin: grantOrigin,
          sessionPublicKey: null,
          capability: grantCapability,
          capabilityGroupKey: null,
        })),
        ...pendingCapabilityGroupKeys.map((capabilityGroupKey): DeploymentGrantOverride => ({
          deploymentId: storageDeploymentId,
          identityKind: "web",
          grantKind: "capability-group",
          contractId: grantContractId,
          origin: grantOrigin,
          sessionPublicKey: null,
          capability: null,
          capabilityGroupKey,
        })),
      ];
    }
    if (!grantSessionPublicKey) return [];
    return [
      ...pendingDirectCapabilityKeys.map((grantCapability): DeploymentGrantOverride => ({
        deploymentId: storageDeploymentId,
        identityKind: "session",
        grantKind: "capability",
        contractId: grantContractId,
        origin: null,
        sessionPublicKey: grantSessionPublicKey,
        capability: grantCapability,
        capabilityGroupKey: null,
      })),
      ...pendingCapabilityGroupKeys.map((capabilityGroupKey): DeploymentGrantOverride => ({
        deploymentId: storageDeploymentId,
        identityKind: "session",
        grantKind: "capability-group",
        contractId: grantContractId,
        origin: null,
        sessionPublicKey: grantSessionPublicKey,
        capability: null,
        capabilityGroupKey,
      })),
    ];
  }

  async function load(): Promise<void> {
    loading = true;
    error = null;
    saved = null;
    try {
      const [listResponse, capabilitiesResponse, groupsResponse] = await Promise.all([
        authRpc.request("Auth.Envelopes.List", { limit: 500, offset: 0 }).take(),
        authRpc.request("Auth.Capabilities.List", { limit: 500, offset: 0 }).take(),
        authRpc.request("Auth.CapabilityGroups.List", { limit: 500, offset: 0 }).take(),
      ]);
      if (isErr(listResponse)) {
        error = errorMessage(listResponse);
        deployments = [];
        existingOverrides = [];
        return;
      }
      if (isErr(capabilitiesResponse)) {
        error = errorMessage(capabilitiesResponse);
        capabilities = [];
        return;
      }
      if (isErr(groupsResponse)) {
        error = errorMessage(groupsResponse);
        capabilityGroups = [];
        return;
      }

      deployments = listResponse.entries;
      capabilities = (capabilitiesResponse.entries ?? []).slice().sort((left, right) => left.key.localeCompare(right.key));
      capabilityGroups = groupsResponse.entries ?? [];
      const details = await Promise.all(deployments.map((deployment) => loadDeploymentGrantOverrides(deployment)));
      existingOverrides = details.flat().map(cleanGrantOverride);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function loadDeploymentGrantOverrides(deployment: DeploymentEnvelope): Promise<DeploymentGrantOverride[]> {
    const response = await authRpc.request("Auth.Envelopes.Get", { deploymentId: deployment.deploymentId }).take();
    if (isErr(response)) throw new Error(`Failed to load ${deployment.deploymentId}: ${errorMessage(response)}`);
    return response.grantOverrides.map(cleanGrantOverride);
  }

  async function addGrantOverride(event?: SubmitEvent): Promise<void> {
    event?.preventDefault();
    const newOverrides = buildOverrides();
    if (newOverrides.length === 0) {
      error = storageDeploymentId
        ? "Enter a contract id, selected grant mode value, and at least one capability or capability group."
        : "An enabled authority envelope is required before overrides can become effective.";
      saved = null;
      return;
    }

    const uniqueNewOverrides = newOverrides.filter((nextOverride) =>
      !existingOverrides.some((override) => enabledDeploymentIds.has(override.deploymentId) && sameGrantIdentity(override, nextOverride))
    );
    if (uniqueNewOverrides.length === 0) {
      saved = "Grant override already exists; no changes saved.";
      error = null;
      return;
    }

    const existingForStorageDeployment = existingOverrides
      .filter((override) => override.deploymentId === storageDeploymentId)
      .map(cleanGrantOverride);
    saving = true;
    error = null;
    saved = null;
    try {
      const response = await authRpc.request("Auth.Envelopes.GrantOverrides.Put", {
        deploymentId: storageDeploymentId,
        overrides: [...existingForStorageDeployment, ...uniqueNewOverrides.map(cleanGrantOverride)],
      }).take();
      if (isErr(response)) {
        error = errorMessage(response);
        return;
      }
      saved = `Added ${uniqueNewOverrides.length} grant override${uniqueNewOverrides.length === 1 ? "" : "s"} stored with ${storageDeploymentId}.`;
      await goto(resolve("/admin/grants"));
    } catch (e) {
      error = errorMessage(e);
    } finally {
      saving = false;
    }
  }

  onMount(() => { void load(); });
</script>

<section class="mx-auto max-w-5xl space-y-4">
  <div>
    <a class="btn btn-ghost btn-sm" href={resolve("/admin/grants")}>Back to grants</a>
  </div>

  {#if error}
    <Notice variant="error">{error}</Notice>
  {/if}
  {#if saved}
    <Notice variant="success">{saved}</Notice>
  {/if}

  {#if loading}
    <Panel><LoadingState label="Loading grant catalog" /></Panel>
  {:else}
    <form class="space-y-4" onsubmit={addGrantOverride}>
      <Panel title="New grant override" eyebrow="Append to authority deployment override set">
        {#snippet actions()}
          {#if storageDeployment}
            <span class="trellis-metadata text-[0.65rem]">Storage envelope {storageDeployment.deploymentId}</span>
          {:else}
            <span class="badge badge-warning badge-sm">No enabled envelope</span>
          {/if}
        {/snippet}

        <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <label class="form-control">
            <span class="label-text text-xs">Identity kind</span>
            <select class="select select-bordered select-sm" bind:value={identityKind} disabled={busy}>
              {#each grantIdentityKinds as kind (kind)}<option value={kind}>{kind}</option>{/each}
            </select>
          </label>
          <label class="form-control">
            <span class="label-text text-xs">Contract id</span>
            <input class="input input-bordered input-sm trellis-identifier" placeholder="contract.id" bind:value={contractId} disabled={busy} required />
          </label>
          {#if identityKind === "web"}
            <label class="form-control">
              <span class="label-text text-xs">Web origin</span>
              <input class="input input-bordered input-sm trellis-identifier" placeholder="https://app.example" bind:value={origin} disabled={busy} required />
            </label>
          {:else}
            <label class="form-control">
              <span class="label-text text-xs">Session key</span>
              <input class="input input-bordered input-sm trellis-identifier" placeholder="session public key" bind:value={sessionPublicKey} disabled={busy} required />
            </label>
          {/if}
        </div>
      </Panel>

      <div class="grid gap-3 lg:grid-cols-2">
        <Panel title="Capability groups" eyebrow="Group references">
          {#snippet actions()}
            <span class="trellis-metadata text-[0.65rem]">{selectedCapabilityGroups.length} selected</span>
          {/snippet}
          <SelectionGroup title="Capability groups" count={selectedCapabilityGroups.length} bodyClass="max-h-64 overflow-y-auto rounded border border-base-300 bg-base-100/40">
            {#each sortedCapabilityGroups as group (group.groupKey)}
              <ChoiceRow>
                {#snippet input()}
                  <input class="checkbox checkbox-sm mt-0.5" type="checkbox" bind:group={selectedCapabilityGroups} value={group.groupKey} disabled={busy} />
                {/snippet}
                <span class="min-w-0">
                  <span class="trellis-identifier block truncate font-medium text-base-content">{group.groupKey}</span>
                  <span class="mt-0.5 block truncate text-base-content/60" title={group.displayName}>{group.displayName}</span>
                  <span class="trellis-field-help block">{group.capabilities.length} capabilities · {group.includedGroups.length} included groups</span>
                </span>
              </ChoiceRow>
            {:else}
              <div class="px-2 py-3 trellis-metadata text-xs">No capability groups were returned.</div>
            {/each}
          </SelectionGroup>
        </Panel>

        <Panel title="Direct capabilities" eyebrow="Concrete grants">
          {#snippet actions()}
            <span class="trellis-metadata text-[0.65rem]">{selectedCapabilities.length} selected</span>
          {/snippet}
          <SelectionGroup title="Direct capabilities" count={selectedCapabilities.length} bodyClass="max-h-64 overflow-y-auto rounded border border-base-300 bg-base-100/40">
            {#each capabilitySections as section (section.key)}
              <SelectionSectionHeader title={section.title} subtitle={section.subtitle ?? undefined} count={section.capabilities.length} />
              {#each section.capabilities as item (item.key)}
                <ChoiceRow>
                  {#snippet input()}
                    <input class="checkbox checkbox-sm mt-0.5" type="checkbox" bind:group={selectedCapabilities} value={item.key} disabled={busy} />
                  {/snippet}
                  <span class="min-w-0">
                    <span class="block truncate font-medium text-base-content" title={item.description}>{item.description}</span>
                    <span class="trellis-identifier mt-0.5 block break-all text-base-content/50">{localCapabilityKey(item.key)}</span>
                  </span>
                </ChoiceRow>
              {/each}
            {:else}
              <div class="px-2 py-3 trellis-metadata text-xs">No catalog capabilities were returned.</div>
            {/each}
          </SelectionGroup>
        </Panel>
      </div>

      <Panel title="Grant behavior" eyebrow="Persistence">
        <div class="flex items-center justify-between gap-3">
          <div class="space-y-1 text-xs text-base-content/55">
            {#if storageDeployment}
              <p>Grants are keyed by contract+origin for web or contract+session key for session clients. Direct capabilities are stored as concrete capability grants; capability groups are stored by group key so future group membership changes apply.</p>
              {#if storageDeployment.disabled}
                <p class="text-warning">An enabled authority envelope is required before overrides can become effective.</p>
              {/if}
            {:else}
              <p class="text-warning">An enabled authority envelope is required before overrides can become effective.</p>
            {/if}
            <p>Selection will store {pendingDirectCapabilityKeys.length} direct capability grant{pendingDirectCapabilityKeys.length === 1 ? "" : "s"} and {pendingCapabilityGroupKeys.length} capability group grant{pendingCapabilityGroupKeys.length === 1 ? "" : "s"}.</p>
          </div>
          <div class="flex shrink-0 gap-2">
            <a class="btn btn-ghost btn-sm" href={resolve("/admin/grants")}>Cancel</a>
            <button class="btn btn-primary btn-sm" type="submit" disabled={busy || !storageDeploymentId || !contractId.trim() || !requiredIdentityValue || pendingGrantReferenceCount === 0}>{saving ? "Saving..." : "Add grant"}</button>
          </div>
        </div>
      </Panel>
    </form>
  {/if}
</section>
