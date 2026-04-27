<script lang="ts">
  import { isErr } from "@qlever-llc/result";
  import type {
    AuthGetInstalledContractOutput,
    AuthListInstalledContractsOutput,
  } from "@qlever-llc/trellis/sdk/auth";
  import { onMount } from "svelte";
  import EmptyState from "../../../../lib/components/EmptyState.svelte";
  import LoadingState from "../../../../lib/components/LoadingState.svelte";
  import PageToolbar from "../../../../lib/components/PageToolbar.svelte";
  import Panel from "../../../../lib/components/Panel.svelte";
  import { errorMessage, formatDate } from "../../../../lib/format";
  import { getTrellis } from "../../../../lib/trellis";

  const trellis = getTrellis();

  type ContractSummary = {
    digest: string;
    id: string;
    displayName: string;
    description: string;
    sessionKey?: string;
    installedAt: string;
    analysisSummary?: {
      events: number;
      kvResources: number;
      namespaces: string[];
      natsPublish: number;
      natsSubscribe: number;
      rpcMethods: number;
    };
    resourceBindings?: { kv?: Record<string, { bucket: string; history: number; ttlMs: number }> };
  };

  type AnalysisDetail = {
    rpc: { methods: { key: string; subject: string; callerCapabilities: string[] }[] };
    events: { events: { key: string; subject: string; publishCapabilities: string[]; subscribeCapabilities: string[] }[] };
    nats: {
      publish: { kind: string; subject: string; requiredCapabilities: string[] }[];
      subscribe: { kind: string; subject: string; requiredCapabilities: string[] }[];
    };
    resources: { kv: { alias: string; purpose: string; required: boolean; history?: number; ttlMs?: number }[] };
  };

  type ContractDetail = ContractSummary & {
    resources?: { kv?: Record<string, { purpose: string; required?: boolean; history?: number; ttlMs?: number }> };
    analysis?: AnalysisDetail;
    contract: Record<string, unknown>;
  };

  let analysisSection = $state<string | null>(null);

  function toggleAnalysis(section: string) {
    analysisSection = analysisSection === section ? null : section;
  }

  let loading = $state(true);
  let detailLoading = $state(false);
  let error = $state<string | null>(null);
  let search = $state("");
  let contracts = $state<ContractSummary[]>([]);
  let selectedDigest = $state<string | null>(null);
  let detail = $state<ContractDetail | null>(null);

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contracts;
    return contracts.filter((c) =>
      [c.id, c.digest, c.displayName, c.description]
        .filter(Boolean).some((v) => v.toLowerCase().includes(q))
    );
  });

  async function listInstalledContracts(): Promise<AuthListInstalledContractsOutput | null> {
    const res = await trellis.request("Auth.ListInstalledContracts", {}).take();
    if (isErr(res)) { error = errorMessage(res); return null; }
    return res;
  }

  async function getInstalledContract(digest: string): Promise<AuthGetInstalledContractOutput | null> {
    const res = await trellis.request("Auth.GetInstalledContract", { digest }).take();
    if (isErr(res)) { error = errorMessage(res); return null; }
    return res;
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await listInstalledContracts();
      if (!res) return;
      contracts = res.contracts ?? [];
    } catch (e) { error = errorMessage(e); }
    finally { loading = false; }
  }

  async function selectContract(digest: string) {
    if (selectedDigest === digest) { selectedDigest = null; detail = null; return; }
    selectedDigest = digest;
    detailLoading = true;
    try {
      const res = await getInstalledContract(digest);
      if (!res) return;
      detail = res.contract;
    } catch (e) { error = errorMessage(e); detail = null; }
    finally { detailLoading = false; }
  }

  onMount(() => { void load(); });
</script>

<section class="space-y-4">
  <PageToolbar title="Contracts" description="Installed contract surfaces, resource bindings, and capability requirements.">
    {#snippet actions()}
      <input class="input input-bordered input-sm w-64" placeholder="Search contracts…" bind:value={search} />
      <button class="btn btn-ghost btn-sm" onclick={load} disabled={loading}>Refresh</button>
    {/snippet}
  </PageToolbar>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  {#if loading}
    <LoadingState label="Loading installed contracts" />
  {:else}
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.35fr)]">
      <Panel title="Contract List" eyebrow="Primary" class="min-w-0">
        {#if filtered.length === 0}
          <EmptyState title="No contracts found" description="Adjust the search query or refresh the installed contract list." />
        {:else}
          <ul class="space-y-1 overflow-y-auto lg:max-h-[70vh]">
            {#each filtered as contract (contract.digest)}
              <li>
                <button
                  class={[
                    "w-full rounded-box border p-3 text-left transition-colors hover:bg-base-200/70",
                    selectedDigest === contract.digest ? "border-primary bg-base-200" : "border-base-300 bg-base-100",
                  ]}
                  onclick={() => selectContract(contract.digest)}
                >
                  <p class="font-medium text-sm">{contract.displayName || contract.id}</p>
                  <div class="mt-1 flex gap-2">
                    <span class="trellis-identifier text-base-content/50">{contract.digest.slice(0, 12)}…</span>
                    <span class="badge badge-outline badge-xs">{contract.analysisSummary?.rpcMethods ?? 0} RPC</span>
                    <span class="badge badge-outline badge-xs">{contract.analysisSummary?.events ?? 0} Events</span>
                  </div>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </Panel>

      <Panel title="Contract Detail" eyebrow="Secondary" class="min-w-0">
        {#if detailLoading}
          <LoadingState label="Loading contract detail" class="min-h-40" />
        {:else if detail}
              <div>
                <h3 class="font-semibold">{detail.displayName || detail.id}</h3>
                {#if detail.description}
                  <p class="text-sm text-base-content/60 mt-1">{detail.description}</p>
                {/if}
              </div>

              <div class="grid grid-cols-2 gap-2 text-sm">
                <div><span class="text-base-content/50">ID:</span> {detail.id}</div>
                <div class="col-span-2"><span class="text-base-content/50">Digest:</span> <span class="trellis-identifier">{detail.digest}</span></div>
                <div><span class="text-base-content/50">Installed:</span> {formatDate(detail.installedAt)}</div>
              </div>

              {#if detail.analysisSummary}
                <div>
                  <h4 class="text-xs font-semibold uppercase text-base-content/50 mb-2">Analysis</h4>
                  <div class="flex flex-wrap gap-2">
                    <button class={["badge badge-outline badge-sm cursor-pointer", { "badge-primary": analysisSection === "rpc" }]} onclick={() => toggleAnalysis("rpc")}>{detail.analysisSummary.rpcMethods} RPCs</button>
                    <button class={["badge badge-outline badge-sm cursor-pointer", { "badge-primary": analysisSection === "events" }]} onclick={() => toggleAnalysis("events")}>{detail.analysisSummary.events} Events</button>
                    <button class={["badge badge-outline badge-sm cursor-pointer", { "badge-primary": analysisSection === "kv" }]} onclick={() => toggleAnalysis("kv")}>{detail.analysisSummary.kvResources} KV</button>
                    <button class={["badge badge-outline badge-sm cursor-pointer", { "badge-primary": analysisSection === "pub" }]} onclick={() => toggleAnalysis("pub")}>{detail.analysisSummary.natsPublish} Pub</button>
                    <button class={["badge badge-outline badge-sm cursor-pointer", { "badge-primary": analysisSection === "sub" }]} onclick={() => toggleAnalysis("sub")}>{detail.analysisSummary.natsSubscribe} Sub</button>
                  </div>
                </div>

                {#if analysisSection && detail.analysis}
                  <div class="bg-base-200 rounded-lg p-3">
                    {#if analysisSection === "rpc" && detail.analysis.rpc?.methods?.length}
                      <table class="table table-xs trellis-table">
                        <thead><tr><th>Method</th><th>Subject</th><th>Capabilities</th></tr></thead>
                        <tbody>
                          {#each detail.analysis.rpc.methods as m (m.key)}
                            <tr>
                              <td class="font-medium">{m.key}</td>
                               <td class="trellis-identifier text-base-content/60">{m.subject}</td>
                              <td>{m.callerCapabilities.length ? m.callerCapabilities.join(", ") : "—"}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    {:else if analysisSection === "events" && detail.analysis.events?.events?.length}
                      <table class="table table-xs trellis-table">
                        <thead><tr><th>Event</th><th>Subject</th><th>Pub</th><th>Sub</th></tr></thead>
                        <tbody>
                          {#each detail.analysis.events.events as e (e.key)}
                            <tr>
                              <td class="font-medium">{e.key}</td>
                               <td class="trellis-identifier text-base-content/60">{e.subject}</td>
                              <td class="text-xs">{e.publishCapabilities.join(", ") || "—"}</td>
                              <td class="text-xs">{e.subscribeCapabilities.join(", ") || "—"}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    {:else if analysisSection === "kv" && detail.analysis.resources?.kv?.length}
                      <table class="table table-xs trellis-table">
                        <thead><tr><th>Alias</th><th>Purpose</th><th>History</th><th>TTL</th><th>Required</th></tr></thead>
                        <tbody>
                          {#each detail.analysis.resources.kv as r (r.alias)}
                            <tr>
                              <td class="font-medium">{r.alias}</td>
                              <td class="text-base-content/60">{r.purpose}</td>
                              <td>{r.history ?? "—"}</td>
                              <td>{r.ttlMs ? `${r.ttlMs}ms` : "None"}</td>
                              <td>{r.required ? "Yes" : "No"}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    {:else if analysisSection === "pub" && detail.analysis.nats?.publish?.length}
                      <table class="table table-xs trellis-table">
                        <thead><tr><th>Kind</th><th>Subject</th><th>Capabilities</th></tr></thead>
                        <tbody>
                          {#each detail.analysis.nats.publish as p (`${p.kind}:${p.subject}`)}
                            <tr>
                              <td class="font-medium">{p.kind}</td>
                               <td class="trellis-identifier text-base-content/60">{p.subject}</td>
                              <td class="text-xs">{p.requiredCapabilities.join(", ") || "—"}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    {:else if analysisSection === "sub" && detail.analysis.nats?.subscribe?.length}
                      <table class="table table-xs trellis-table">
                        <thead><tr><th>Kind</th><th>Subject</th><th>Capabilities</th></tr></thead>
                        <tbody>
                          {#each detail.analysis.nats.subscribe as s (`${s.kind}:${s.subject}`)}
                            <tr>
                              <td class="font-medium">{s.kind}</td>
                               <td class="trellis-identifier text-base-content/60">{s.subject}</td>
                              <td class="text-xs">{s.requiredCapabilities.join(", ") || "—"}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    {:else}
                      <p class="text-sm text-base-content/50">No details available.</p>
                    {/if}
                  </div>
                {/if}
              {/if}

              {#if detail.resourceBindings?.kv}
                <div>
                  <h4 class="text-xs font-semibold uppercase text-base-content/50 mb-2">KV Bindings</h4>
                  <div class="space-y-1">
                    {#each Object.entries(detail.resourceBindings.kv) as [alias, binding] (alias)}
                      <div class="flex justify-between text-sm p-2 bg-base-200 rounded">
                        <span class="font-medium">{alias}</span>
                         <span class="trellis-identifier text-base-content/60">{binding.bucket}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              <div class="collapse collapse-arrow bg-base-200 rounded-lg">
                <input type="checkbox" />
                <div class="collapse-title text-xs font-semibold uppercase text-base-content/50">Raw Contract</div>
                <div class="collapse-content">
                   <pre class="max-h-80 overflow-auto text-xs font-mono">{JSON.stringify(detail.contract, null, 2)}</pre>
                </div>
              </div>
        {:else if selectedDigest}
          <EmptyState title="Contract detail unavailable" description="Select the contract again or refresh the contract list." />
        {:else}
          <EmptyState title="Select a contract" description="Choose an installed contract from the list to inspect RPC methods, events, KV resources, pub/sub surfaces, and capabilities." />
        {/if}
      </Panel>
    </div>
  {/if}
</section>
