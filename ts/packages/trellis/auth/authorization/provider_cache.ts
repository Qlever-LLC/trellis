import type { KvWatchEntry } from "@nats-io/kv";
import type { NatsConnection } from "@nats-io/nats-core";

import type {
  AuthorizationContextHandle,
  AuthorizationContextVerificationPolicy,
  AuthorizationVerificationErrorCode,
  VerifiedAuthorizationContextTokenProjection,
  VerifyAuthorizationEventArgs,
  VerifyAuthorizationEventResult,
  VerifyAuthorizationRequestArgs,
  VerifyAuthorizationRequestResult,
} from "../protocol_wasm.ts";
import { canonicalizeJsonValue } from "../utils.ts";
import {
  type AuthorizationContextCache,
  authorizationContextVerificationPolicy,
} from "./client_context.ts";
import {
  type AuthorizationRegistryIoCounters,
  AuthorizationRegistryReader,
  type ManifestPointer,
  parseManifestPointer,
  type RegistryEntry,
  registryWatchEntry,
} from "./nats_registry.ts";
import type {
  AuthorizationProviderEvent,
  AuthorizationProviderRequest,
  AuthorizationRegistryBinding,
  AuthorizationTrustBundle,
} from "./types.ts";

const REVOCATION_PREFIX = "revocation.";
const MAX_CACHED_CONTEXTS = 256;

/** Observable provider registry health. */
export type AuthorizationProviderCacheHealth = {
  manifestRevision: number;
  revocationRevision: number;
  lastUpdateAt: number;
  healthy: boolean;
};

/** Provider I/O counters used by local hot-path tests and diagnostics. */
export type AuthorizationProviderIoCounters =
  & AuthorizationRegistryIoCounters
  & {
    contextResolves: number;
    contextVerifications: number;
  };

/** Internal marker for retryable provider registry or readiness failure. */
export class AuthorizationProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationProviderUnavailableError";
  }
}

/** Provider attach options; the registry binding itself remains internal. */
export type AuthorizationProviderCacheOptions = {
  now?: () => number;
};

type ManifestRecord = {
  pointer: ManifestPointer;
  value: Record<string, unknown>;
};

type VerifiedContextState = {
  handle: AuthorizationContextHandle;
  verified: VerifiedAuthorizationContextTokenProjection;
};

type ProviderContextEntry = {
  epoch: number;
  contextDigest: string;
  context: Record<string, unknown>;
  manifestGeneration: number;
  root: unknown;
  // Let wasm-bindgen finalize dropped handles; explicit free can race in-flight callers.
  handle?: AuthorizationContextHandle;
  verified?: VerifiedAuthorizationContextTokenProjection;
  verifying?: Promise<VerifiedContextState>;
};

type WatchOutcome = "restart" | "stopped";

const integrationTestContexts = new WeakMap<
  AuthorizationProviderCache,
  Map<string, ProviderContextEntry>
>();

/** @internal Returns verified contexts for live integration assertions. */
export function integrationTestResolvedContexts(
  cache: AuthorizationProviderCache,
): Array<{
  contextDigest: string;
  context: Record<string, unknown>;
  manifestGeneration: number;
}> {
  return [...(integrationTestContexts.get(cache)?.values() ?? [])].map(
    (entry) => ({
      contextDigest: entry.contextDigest,
      context: structuredClone(entry.context),
      manifestGeneration: entry.manifestGeneration,
    }),
  );
}

/**
 * Connected provider-side authorization verifier.
 *
 * Unknown contexts resolve only through the connected NATS authorization KV
 * registry. Once resolved, request and event verification is memory-only apart
 * from the Rust/WASM verifier call.
 */
export class AuthorizationProviderCache {
  readonly #registry: AuthorizationRegistryReader;
  readonly #cache: AuthorizationContextCache;
  readonly #root: unknown;
  readonly #trust: AuthorizationTrustBundle;
  readonly #now: () => number;
  #minimumManifestGeneration: number;
  #currentManifest?: ManifestRecord;
  #contexts = new Map<string, ProviderContextEntry>();
  #inFlight = new Map<string, Promise<ProviderContextEntry>>();
  #revocations = new Map<string, number>();
  #revocationRevisions = new Map<string, number>();
  #health: AuthorizationProviderCacheHealth = {
    manifestRevision: 0,
    revocationRevision: 0,
    lastUpdateAt: 0,
    healthy: false,
  };
  #contextResolves = 0;
  #contextVerifications = 0;
  #stopped = false;
  #connected = true;
  #restartWatch?: () => void;
  #manifestEpoch = 0;
  #task?: Promise<void>;
  #readyWaiters = new Set<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }>();

  private constructor(
    registry: AuthorizationRegistryReader,
    cache: AuthorizationContextCache,
    bundle: ReturnType<AuthorizationContextCache["bundle"]>,
    material: ReturnType<
      AuthorizationContextCache["installedVerificationMaterial"]
    >,
    options: AuthorizationProviderCacheOptions,
  ) {
    this.#registry = registry;
    this.#cache = cache;
    this.#root = structuredClone(material.root);
    this.#trust = structuredClone(bundle.trust);
    this.#minimumManifestGeneration = cache.minimumManifestGeneration();
    this.#now = options.now ?? cache.correctedNowSeconds.bind(cache);
    integrationTestContexts.set(this, this.#contexts);
    {
      const manifest = parseRecord(
        structuredClone(material.manifest),
        "installed authorization issuer manifest",
      );
      const context = structuredClone(material.verified.context);
      const manifestRecord: ManifestRecord = {
        pointer: {
          generation: material.verified.manifestGeneration,
          digest: material.verified.manifestDigest,
          revision: 0,
        },
        value: manifest,
      };
      this.#currentManifest = manifestRecord;
      this.#contexts.set(material.contextDigest, {
        epoch: this.#manifestEpoch,
        contextDigest: material.contextDigest,
        context,
        manifestGeneration: material.verified.manifestGeneration,
        root: structuredClone(material.root),
        verified: structuredClone(material.verified),
      });
    }
  }

  /** Attach to the bootstrap-selected NATS authorization registry. */
  static async attach(
    nats: NatsConnection,
    binding: AuthorizationRegistryBinding,
    cache: AuthorizationContextCache,
    options: AuthorizationProviderCacheOptions = {},
  ): Promise<AuthorizationProviderCache> {
    const bundle = cache.bundle();
    const material = cache.installedVerificationMaterial();
    if (
      canonicalizeJsonValue(binding) !==
        canonicalizeJsonValue(bundle.trust.authorizationRegistry) ||
      canonicalizeJsonValue(material.root) !==
        canonicalizeJsonValue(bundle.trust.root)
    ) {
      throw new Error("authorization trust or registry binding does not match");
    }
    const registry = await AuthorizationRegistryReader.open(
      nats,
      binding,
    );
    return new AuthorizationProviderCache(
      registry,
      cache,
      bundle,
      material,
      options,
    );
  }

  /** Start the registry watches and initialize their current state. */
  start(): void {
    if (this.#task) return;
    this.#stopped = false;
    this.#markUnhealthy();
    this.#task = this.#run();
  }

  /** Stop watches without closing the caller-owned NATS connection. */
  stop(): void {
    this.#stopped = true;
    this.#health.healthy = false;
    this.#contexts.clear();
    for (const waiter of this.#readyWaiters) {
      waiter.reject(
        new Error("authorization provider stopped before readiness"),
      );
    }
    this.#readyWaiters.clear();
  }

  /** Wait until current manifest and revocation watch state are initialized. */
  waitReady(options: {
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}): Promise<void> {
    if (this.#stopped) {
      return Promise.reject(
        new Error("authorization provider stopped before readiness"),
      );
    }
    if (this.#health.healthy) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject };
      this.#readyWaiters.add(waiter);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const abort = () => {
        this.#readyWaiters.delete(waiter);
        if (timer !== undefined) clearTimeout(timer);
        reject(
          options.signal?.reason ?? new DOMException("Aborted", "AbortError"),
        );
      };
      if (options.signal) {
        if (options.signal.aborted) {
          abort();
          return;
        }
        options.signal.addEventListener("abort", abort, { once: true });
      }
      if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.#readyWaiters.delete(waiter);
          reject(new Error("authorization provider readiness timed out"));
        }, options.timeoutMs);
      }
    });
  }

  /** Return the current registry-watch health. */
  health(): AuthorizationProviderCacheHealth {
    return { ...this.#health };
  }

  /** Return provider and registry I/O counters. */
  ioCounters(): AuthorizationProviderIoCounters {
    return {
      ...this.#registry.ioCounters(),
      contextResolves: this.#contextResolves,
      contextVerifications: this.#contextVerifications,
    };
  }

  /** Apply framework-level NATS lifecycle state to provider readiness. */
  observeConnectionPhase(
    phase: "connected" | "disconnected" | "reconnecting" | "error" | "closed",
  ): void {
    // NATS reports denied publishes and other request-scoped failures as
    // `error` while the connection and registry watches remain healthy.
    if (phase === "error") return;
    const wasConnected = this.#connected;
    this.#connected = phase === "connected";
    if (!this.#connected) {
      this.#markUnhealthy();
      this.#restartWatch?.();
      if (wasConnected && phase !== "closed") this.#cache.requestRefresh();
    }
  }

  /** Resolve one context digest through the connected registry. */
  async resolveContext(
    contextDigest: string,
  ): Promise<VerifiedAuthorizationContextTokenProjection> {
    this.#requireHealthy();
    await this.#refreshRevocation(contextDigest);
    const entry = await this.#resolveEntry(contextDigest);
    const state = await this.#ensureVerified(entry, false, this.#now());
    const { assertAuthorizationContextHandleCurrentWasm } = await import(
      "../protocol_wasm.ts"
    );
    assertAuthorizationContextHandleCurrentWasm(
      state.handle,
      this.#policyFor(entry, this.#now()),
    );
    return structuredClone(state.verified);
  }

  /** Verify a presented request proof with exact route permissions. */
  async verifyRequest(
    request: AuthorizationProviderRequest,
  ): Promise<VerifyAuthorizationRequestResult> {
    try {
      this.#requireHealthy();
      await this.#refreshRevocation(request.contextDigest);
      const entry = await this.#resolveEntry(request.contextDigest);
      const { verifyAuthorizationRequestWasm } = await import(
        "../protocol_wasm.ts"
      );
      const { handle } = await this.#ensureVerified(entry, false, this.#now());
      const result = await verifyAuthorizationRequestWasm({
        contextHandle: handle,
        ...this.#requestInput(entry, request),
      });
      if (!result.ok) return structuredClone(result);
      if (this.#revocationEvidence(entry.contextDigest) !== undefined) {
        return providerRequestFailure(
          "PermissionDenied",
          "/authorization-context",
        );
      }
      return structuredClone(result);
    } catch {
      return providerRequestFailure("InvalidInput", "/authorization-context");
    }
  }

  /** Verify a presented event proof with exact publish permissions. */
  async verifyEvent(
    event: AuthorizationProviderEvent,
  ): Promise<VerifyAuthorizationEventResult> {
    try {
      this.#requireHealthy();
      parseEventTime(event.eventTime);
      await this.#refreshRevocation(event.contextDigest);
      const entry = await this.#resolveEntry(event.contextDigest);
      const revokedAt = this.#revocationEvidence(entry.contextDigest);
      const { verifyAuthorizationEventWasm } = await import(
        "../protocol_wasm.ts"
      );
      const { handle } = await this.#ensureVerified(entry, true, this.#now());
      const result = await verifyAuthorizationEventWasm({
        contextHandle: handle,
        ...this.#eventInput(entry, event, revokedAt ?? null),
      });
      if (!result.ok) return structuredClone(result);
      return structuredClone(result);
    } catch (error) {
      if (error instanceof AuthorizationProviderUnavailableError) throw error;
      return providerEventFailure("InvalidInput", "/authorization-context");
    }
  }

  async #run(): Promise<void> {
    while (!this.#stopped) {
      try {
        const outcome = await this.#watchOnce();
        if (outcome === "stopped") return;
      } catch {
        this.#markUnhealthy();
      }
      if (this.#stopped) return;
      await delay(250);
    }
  }

  async #watchOnce(): Promise<WatchOutcome> {
    this.#assertSourceTrust();
    let requestRestart = () => {};
    const restart = new Promise<{ kind: "restart" }>((resolve) => {
      requestRestart = () => resolve({ kind: "restart" });
    });
    this.#restartWatch = requestRestart;
    const manifestWatch = await this.#registry.watchManifestCurrent();
    let revocationWatch:
      | { iterator: AsyncIterator<KvWatchEntry>; initialPending: number }
      | undefined;
    let ownContextDigest: string | undefined;
    try {
      ownContextDigest = this.#cache.current().contextDigest;
    } catch {
      // Recovery may start without an installed context.
    }
    if (ownContextDigest) {
      revocationWatch = await this.#registry.watchRevocation(ownContextDigest);
    }
    try {
      await this.#initializeManifest();
      if (revocationWatch) {
        for (
          let index = 0;
          index < revocationWatch.initialPending;
          index += 1
        ) {
          const next = await revocationWatch.iterator.next();
          if (next.done) {
            throw new Error("authorization revocation watch ended");
          }
          this.#observeRevocation(next.value);
        }
      }
      if (!this.#connected) return "restart";
      this.#markReady();
      let manifestNext = manifestWatch.next();
      let revocationNext = revocationWatch?.iterator.next();
      while (!this.#stopped) {
        const event = await Promise.race([
          manifestNext.then((result) => ({
            kind: "manifest" as const,
            result,
          })),
          ...(revocationNext
            ? [
              revocationNext.then((result) => ({
                kind: "revocation" as const,
                result,
              })),
            ]
            : []),
          restart,
        ]);
        if (event.kind === "restart") return "restart";
        if (event.result.done) {
          throw new Error(`${event.kind} authorization registry watch ended`);
        }
        if (event.kind === "revocation") {
          revocationNext = revocationWatch?.iterator.next();
          this.#observeRevocation(event.result.value);
          continue;
        }
        if (event.kind === "manifest") {
          manifestNext = manifestWatch.next();
          this.#markUnhealthy();
          const pointer = parseManifestPointer(event.result.value.value);
          await this.#observeManifest(
            { ...pointer, revision: event.result.value.revision },
            event.result.value.revision,
          );
          return "restart";
        }
      }
      return "stopped";
    } finally {
      if (this.#restartWatch === requestRestart) this.#restartWatch = undefined;
      await closeIterator(manifestWatch);
      if (revocationWatch) await closeIterator(revocationWatch.iterator);
    }
  }

  async #initializeManifest(): Promise<void> {
    this.#assertSourceTrust();
    const pointer = await this.#registry.getManifestCurrent();
    if (!pointer) throw new Error("authorization manifest.current is missing");
    await this.#observeManifest(pointer, pointer.revision);
    if (this.#stopped) {
      throw new Error("authorization provider stopped during initialization");
    }
  }

  #markReady(): void {
    this.#health.healthy = true;
    this.#health.lastUpdateAt = this.#now();
    for (const waiter of this.#readyWaiters) waiter.resolve();
    this.#readyWaiters.clear();
  }

  async #observeManifest(
    pointer: ManifestPointer,
    revision: number,
  ): Promise<void> {
    if (revision <= this.#health.manifestRevision) return;
    const current = this.#currentManifest;
    if (pointer.generation < this.#minimumManifestGeneration) {
      throw new Error("authorization manifest.current rolled back");
    }
    if (current) {
      if (pointer.generation < current.pointer.generation) {
        throw new Error("authorization manifest.current rolled back");
      }
      if (
        pointer.generation === current.pointer.generation &&
        pointer.digest !== current.pointer.digest
      ) {
        throw new Error(
          "authorization manifest.current equivocates at the accepted generation",
        );
      }
    }
    if (current && pointer.generation === current.pointer.generation) {
      this.#health.manifestRevision = revision;
      this.#health.lastUpdateAt = this.#now();
      return;
    }

    const stored = await this.#registry.getManifest(pointer.generation);
    if (!stored) {
      throw new Error("authorization issuer manifest is missing");
    }
    const value = parseJsonRecord(
      stored.value,
      "authorization issuer manifest",
    );
    const { verifyAuthorizationManifestWasm } = await import(
      "../protocol_wasm.ts"
    );
    const verifiedManifest = await verifyAuthorizationManifestWasm({
      root: this.#root,
      manifest: value,
      policy: authorizationContextVerificationPolicy(
        this.#trust.policy,
        this.#now(),
        this.#minimumManifestGeneration,
      ),
    });
    if (
      verifiedManifest.generation !== pointer.generation ||
      verifiedManifest.digest !== pointer.digest
    ) {
      throw new Error("authorization issuer manifest identity mismatch");
    }
    await this.#cache.advanceManifestFloor(
      verifiedManifest.generation,
      verifiedManifest.digest,
    );
    const record: ManifestRecord = {
      pointer,
      value,
    };
    this.#manifestEpoch += 1;
    this.#inFlight.clear();
    this.#minimumManifestGeneration = verifiedManifest.generation;
    this.#currentManifest = record;
    this.#contexts.clear();
    this.#health.manifestRevision = revision;
    this.#health.lastUpdateAt = this.#now();
    this.#cache.requestRefresh();
  }

  #observeRevocation(
    entry: KvWatchEntry,
  ): void {
    const update = registryWatchEntry(entry);
    const key = update.key;
    const revision = update.revision;
    if (revision < (this.#revocationRevisions.get(key) ?? 0)) return;
    this.#revocationRevisions.set(key, revision);
    this.#health.revocationRevision = Math.max(
      this.#health.revocationRevision,
      revision,
    );
    this.#health.lastUpdateAt = this.#now();
    if (!key.startsWith(REVOCATION_PREFIX)) {
      throw new Error("authorization revocation key is outside its prefix");
    }
    const contextDigest = key.slice(REVOCATION_PREFIX.length);
    assertDigest(contextDigest);
    if ("operation" in update && update.operation === "delete") {
      // Revocation is monotonic: registry cleanup must never restore authority.
      return;
    }
    const value = "value" in update ? update.value : undefined;
    if (!value) throw new Error("authorization revocation value is missing");
    this.#revocations.set(contextDigest, parseRevocation(value));
    try {
      if (this.#cache.current().contextDigest === contextDigest) {
        this.#cache.requestRefresh();
      }
    } catch {
      // No current context is installed.
    }
  }

  async #resolveEntry(contextDigest: string): Promise<ProviderContextEntry> {
    assertDigest(contextDigest);
    const known = this.#contexts.get(contextDigest);
    if (known) {
      this.#contexts.delete(contextDigest);
      this.#contexts.set(contextDigest, known);
      return known;
    }
    const pending = this.#inFlight.get(contextDigest);
    if (pending) return await pending;
    const epoch = this.#manifestEpoch;
    const resolution = this.#resolveUnknown(contextDigest, epoch);
    this.#inFlight.set(contextDigest, resolution);
    try {
      return await resolution;
    } finally {
      if (this.#inFlight.get(contextDigest) === resolution) {
        this.#inFlight.delete(contextDigest);
      }
    }
  }

  async #resolveUnknown(
    contextDigest: string,
    epoch: number,
  ): Promise<ProviderContextEntry> {
    this.#contextResolves += 1;
    let contextEntry: RegistryEntry | null;
    try {
      contextEntry = await this.#registry.getContext(contextDigest);
    } catch (error) {
      throw new AuthorizationProviderUnavailableError(String(error));
    }
    if (!contextEntry) {
      throw new AuthorizationProviderUnavailableError(
        "authorization context is missing from the registry",
      );
    }
    const context = parseJsonRecord(
      contextEntry.value,
      "authorization context registry value",
    );
    const manifestGeneration = providerPositiveInteger(
      context.issuerManifestGeneration,
      "issuerManifestGeneration",
    );
    providerPositiveInteger(context.expiresAt, "expiresAt");
    const entry: ProviderContextEntry = {
      epoch,
      contextDigest,
      context,
      manifestGeneration,
      root: structuredClone(this.#root),
    };
    if (epoch !== this.#manifestEpoch) {
      throw new AuthorizationProviderUnavailableError(
        "authorization manifest advanced during context resolution",
      );
    }
    if (this.#contexts.size >= MAX_CACHED_CONTEXTS) {
      // Bounded LRU; raise the cap only if registry reads prove costly.
      const oldest = this.#contexts.keys().next().value;
      if (oldest) this.#contexts.delete(oldest);
    }
    this.#contexts.set(contextDigest, entry);
    return entry;
  }

  async #ensureVerified(
    entry: ProviderContextEntry,
    historical: boolean,
    verificationTime: number,
  ): Promise<VerifiedContextState> {
    if (!historical && entry.epoch !== this.#manifestEpoch) {
      throw new AuthorizationProviderUnavailableError(
        "authorization manifest advanced during context verification",
      );
    }
    if (
      !historical &&
      entry.manifestGeneration !== this.#currentManifest?.pointer.generation
    ) {
      throw new Error("authorization context manifest is not current");
    }
    const cacheable = entry.epoch === this.#manifestEpoch;
    if (cacheable && entry.handle && entry.verified) {
      return { handle: entry.handle, verified: entry.verified };
    }
    if (entry.verifying) return await entry.verifying;
    const verifying = (async (): Promise<VerifiedContextState> => {
      const chain = await this.#resolveChain(entry);
      const policy = this.#policyFor(entry, verificationTime, historical);
      const { createAuthorizationContextHandleWasm } = await import(
        "../protocol_wasm.ts"
      );
      this.#contextVerifications += 1;
      const result = await createAuthorizationContextHandleWasm({
        root: entry.root,
        manifest: chain.value,
        context: entry.context,
        policy,
        historical: true,
      });
      if (
        (!historical && entry.epoch !== this.#manifestEpoch) || this.#stopped
      ) {
        result.handle.free();
        throw new AuthorizationProviderUnavailableError(
          "authorization registry changed during verification",
        );
      }
      if (
        result.verified.contextDigest !== entry.contextDigest ||
        (chain.pointer.digest !== "" &&
          result.verified.manifestDigest !== chain.pointer.digest) ||
        result.verified.manifestGeneration !== chain.pointer.generation
      ) {
        result.handle.free();
        throw new Error("authorization registry trust identity mismatch");
      }
      if (cacheable) {
        entry.handle = result.handle;
        entry.verified = result.verified;
      }
      return result;
    })();
    entry.verifying = verifying;
    try {
      return await verifying;
    } finally {
      if (entry.verifying === verifying) entry.verifying = undefined;
    }
  }

  async #resolveChain(
    entry: ProviderContextEntry,
  ): Promise<ManifestRecord> {
    const manifest = await this.#resolveManifest(entry.manifestGeneration);
    if (manifest.pointer.generation !== entry.manifestGeneration) {
      throw new Error(
        "authorization evidence does not match its manifest",
      );
    }
    return manifest;
  }

  async #resolveManifest(generation: number): Promise<ManifestRecord> {
    if (this.#currentManifest?.pointer.generation === generation) {
      return this.#currentManifest;
    }
    if (generation >= this.#minimumManifestGeneration) {
      throw new AuthorizationProviderUnavailableError(
        "authorization context manifest is not current",
      );
    }
    let manifestEntry: RegistryEntry | null;
    try {
      manifestEntry = await this.#registry.getManifest(generation);
    } catch (error) {
      throw new AuthorizationProviderUnavailableError(String(error));
    }
    if (!manifestEntry) {
      throw new AuthorizationProviderUnavailableError(
        "historical issuer manifest is missing",
      );
    }
    const value = parseJsonRecord(
      manifestEntry.value,
      "historical issuer manifest",
    );
    const record: ManifestRecord = {
      pointer: {
        generation,
        digest: "",
        revision: manifestEntry.revision,
      },
      value,
    };
    return record;
  }

  #requestInput(
    entry: ProviderContextEntry,
    request: AuthorizationProviderRequest,
  ): Omit<VerifyAuthorizationRequestArgs, "contextHandle"> {
    return {
      subject: request.subject,
      reply: request.reply,
      payload: new Uint8Array(request.payload),
      iat: request.iat,
      requestId: request.requestId,
      proof: request.proof,
      requiredPermissions: structuredClone(request.requiredPermissions),
      requiredCapabilities: [...request.requiredCapabilities],
      policy: this.#policyFor(entry, this.#now()),
    };
  }

  #eventInput(
    entry: ProviderContextEntry,
    event: AuthorizationProviderEvent,
    revokedAt: number | null,
  ): Omit<VerifyAuthorizationEventArgs, "contextHandle"> {
    return {
      subject: event.subject,
      payload: new Uint8Array(event.payload),
      eventId: event.eventId,
      eventTime: event.eventTime,
      proof: event.proof,
      requiredPermissions: structuredClone(event.requiredPermissions),
      requiredCapabilities: [...event.requiredCapabilities],
      policy: this.#policyFor(entry, this.#now(), true),
      revokedAt,
    };
  }

  #policyFor(
    entry: ProviderContextEntry,
    nowUnixSeconds: number,
    historical = false,
  ): AuthorizationContextVerificationPolicy {
    if (
      !historical &&
      entry.manifestGeneration < this.#minimumManifestGeneration
    ) {
      throw new Error(
        "authorization context manifest is below the trust floor",
      );
    }
    const generation = entry.manifestGeneration;
    return authorizationContextVerificationPolicy(
      this.#trust.policy,
      nowUnixSeconds,
      generation,
    );
  }

  #revocationEvidence(contextDigest: string): number | undefined {
    return this.#revocations.get(contextDigest);
  }

  async #refreshRevocation(contextDigest: string): Promise<void> {
    if (this.#revocations.has(contextDigest)) return;
    const entry = await this.#registry.getRevocation(contextDigest);
    if (entry?.operation === "PUT") {
      this.#revocations.set(contextDigest, parseRevocation(entry.value));
    }
  }

  #assertSourceTrust(): void {
    const currentBundle = this.#cache.bundle();
    const currentMaterial = this.#cache.installedVerificationMaterial();
    if (
      canonicalizeJsonValue(currentMaterial.root) !==
        canonicalizeJsonValue(this.#root) ||
      canonicalizeJsonValue(currentBundle.trust.authorizationRegistry) !==
        canonicalizeJsonValue(this.#trust.authorizationRegistry)
    ) {
      throw new Error("authorization provider trust or registry changed");
    }
    const minimumManifestGeneration = Math.max(
      this.#minimumManifestGeneration,
      this.#cache.minimumManifestGeneration(),
    );
    if (minimumManifestGeneration > this.#minimumManifestGeneration) {
      this.#minimumManifestGeneration = minimumManifestGeneration;
      for (const entry of this.#contexts.values()) {
        entry.handle = undefined;
        entry.verified = undefined;
      }
    }
  }

  #requireHealthy(): void {
    this.#assertSourceTrust();
    if (!this.#health.healthy || this.#stopped) {
      throw new AuthorizationProviderUnavailableError(
        "authorization provider is not healthy",
      );
    }
  }

  #markUnhealthy(): void {
    this.#health.healthy = false;
  }
}

function parseJsonRecord(
  value: Uint8Array,
  kind: string,
): Record<string, unknown> {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(value));
  if (
    parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
  ) throw new Error(`${kind} is invalid`);
  return parsed as Record<string, unknown>;
}

function parseRevocation(value: Uint8Array): number {
  const record = parseJsonRecord(value, "authorization context revocation");
  if (
    typeof record.revokedAt !== "number" ||
    !Number.isSafeInteger(record.revokedAt) ||
    record.revokedAt <= 0
  ) {
    throw new Error("authorization context revocation is invalid");
  }
  return record.revokedAt;
}

function parseRecord(value: unknown, kind: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${kind} is invalid`);
  }
  return value as Record<string, unknown>;
}

function providerPositiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function assertDigest(value: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error("authorization context digest is invalid");
  }
}

function parseEventTime(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("event time is invalid");
  return Math.floor(milliseconds / 1_000);
}

async function closeIterator(iterator: AsyncIterator<unknown>): Promise<void> {
  if (typeof iterator.return === "function") {
    await Promise.race([iterator.return(), delay(1_000)]);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function providerRequestFailure(
  code: AuthorizationVerificationErrorCode,
  path: string,
): {
  ok: false;
  error: { code: AuthorizationVerificationErrorCode; path: string };
} {
  return { ok: false, error: { code, path } };
}

function providerEventFailure(
  code: AuthorizationVerificationErrorCode,
  path: string,
): {
  ok: false;
  error: { code: AuthorizationVerificationErrorCode; path: string };
} {
  return { ok: false, error: { code, path } };
}
