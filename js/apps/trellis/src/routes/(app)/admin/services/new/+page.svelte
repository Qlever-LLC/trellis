<script lang="ts">
  import { goto } from "$app/navigation";
  import { createAuthRequester } from "../../../../../lib/auth-rpc";
  import { errorMessage } from "../../../../../lib/format";
  import { getNotifications } from "../../../../../lib/notifications.svelte";

  const authRequest = createAuthRequester() as (method: string, input: unknown) => Promise<any>;
  const notifications = getNotifications();

  let sessionKey = $state("");
  let displayName = $state("");
  let namespaces = $state("");
  let description = $state("");
  let contractJson = $state("");
  let active = $state(true);
  let error = $state<string | null>(null);
  let keygenPending = $state(false);
  let createPending = $state(false);
  let revealedSeed = $state<string | null>(null);

  async function generateKey() {
    keygenPending = true;
    error = null;
    try {
      const keyPair = await crypto.subtle.generateKey(
        { name: "Ed25519" } as any,
        true,
        ["sign", "verify"]
      );
      const pubRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
      const privPkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
      const pubBytes = new Uint8Array(pubRaw);
      const privBytes = new Uint8Array(privPkcs8);

      const toBase64Url = (bytes: Uint8Array) => {
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      };

      sessionKey = toBase64Url(pubBytes);
      revealedSeed = toBase64Url(privBytes);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      keygenPending = false;
    }
  }

  async function copySeed() {
    if (!revealedSeed) return;
    await navigator.clipboard.writeText(revealedSeed);
    notifications.success("Seed copied to clipboard.", "Copied");
  }

  async function install() {
    error = null;
    if (!sessionKey.trim() || !displayName.trim()) {
      error = "Session key and display name are required.";
      return;
    }

    createPending = true;
    try {
      let contract: Record<string, unknown> | undefined;
      if (contractJson.trim()) {
        contract = JSON.parse(contractJson);
      }

      const input: Record<string, unknown> = {
        sessionKey: sessionKey.trim(),
        displayName: displayName.trim(),
        active,
        namespaces: namespaces.split(",").map((n) => n.trim()).filter(Boolean),
        description: description.trim() || undefined
      };
      if (contract) input.contract = contract;

      await authRequest("Auth.InstallService", input);
      notifications.success(`Service "${displayName.trim()}" installed.`, "Installed");
      await goto("/admin/services");
    } catch (e) {
      error = errorMessage(e);
    } finally {
      createPending = false;
    }
  }
</script>

<section class="max-w-2xl mx-auto space-y-4">
  <a href="/admin/services" class="btn btn-ghost btn-sm">← Back to Services</a>

  {#if error}
    <div class="alert alert-error"><span>{error}</span></div>
  {/if}

  <form onsubmit={(e) => { e.preventDefault(); void install(); }}>
    <div class="card bg-base-100 border border-base-300">
      <div class="card-body gap-5">
        <h2 class="card-title text-base">Identity</h2>

        <div class="form-control">
          <label class="label" for="session-key"><span class="label-text">Session key</span></label>
          <div class="flex gap-2">
            <input id="session-key" class="input input-bordered flex-1 font-mono text-sm" placeholder="Ed25519 public key (base64url)" bind:value={sessionKey} />
            <button type="button" class="btn btn-outline btn-sm" onclick={generateKey} disabled={keygenPending}>
              {keygenPending ? "Generating…" : "Generate"}
            </button>
          </div>
        </div>

        {#if revealedSeed}
          <div class="alert alert-info">
            <div class="flex-1">
              <p class="text-xs font-semibold">Seed (save this — it won't be shown again)</p>
              <p class="font-mono text-xs break-all mt-1">{revealedSeed}</p>
            </div>
            <button type="button" class="btn btn-ghost btn-xs" onclick={copySeed}>Copy</button>
          </div>
        {/if}

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="form-control">
            <label class="label" for="display-name"><span class="label-text">Display name</span></label>
            <input id="display-name" class="input input-bordered" placeholder="billing-worker" bind:value={displayName} />
          </div>
          <div class="form-control">
            <label class="label" for="namespaces"><span class="label-text">Namespaces</span></label>
            <input id="namespaces" class="input input-bordered" placeholder="billing, invoices" bind:value={namespaces} />
          </div>
        </div>

        <div class="form-control">
          <label class="label" for="description"><span class="label-text">Description</span></label>
          <textarea id="description" class="textarea textarea-bordered w-full" rows="2" bind:value={description}></textarea>
        </div>

        <h2 class="card-title text-base mt-2">Contract</h2>

        <div class="form-control">
          <label class="label" for="contract-json"><span class="label-text">Contract JSON (optional)</span></label>
          <textarea id="contract-json" class="textarea textarea-bordered w-full font-mono text-xs" rows="10" placeholder="Paste contract JSON here…" bind:value={contractJson}></textarea>
        </div>

        <div class="flex items-center justify-between">
          <label class="label cursor-pointer gap-3">
            <input type="checkbox" class="toggle toggle-primary toggle-sm" bind:checked={active} />
            <span class="label-text">Install as active</span>
          </label>
          <button type="submit" class="btn btn-primary" disabled={createPending}>
            {createPending ? "Installing…" : "Install Service"}
          </button>
        </div>
      </div>
    </div>
  </form>
</section>
