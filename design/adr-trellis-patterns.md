# ADR: Trellis Patterns

## Status

Proposed

## Context

Trellis is a distributed system for aggregating, processing, and distributing organizational data. Services communicate exclusively over NATS.

This ADR establishes patterns for:

- Services, libraries, and frontend apps
- Communication (events and RPCs)
- Type safety and error handling
- Observability and documentation

---

## Architecture

### Service Categories

| Category           | Purpose                                | Examples           |
| ------------------ | -------------------------------------- | ------------------ |
| **Infrastructure** | Platform capabilities for all services | Auth, Jobs         |
| **Ingest**         | Pull external data, emit domain events | Zendesk, FoodLogiQ |
| **Repository**     | Persist and query domain data          | Graph, Search      |
| **Processing**     | Transform, enrich, derive knowledge    | Classification     |
| **Egress**         | Push data to external systems          | Laserfiche         |

Categories describe **primary responsibility**. Any service may subscribe to events for cache invalidation or local state.

### Platform Boundary

Trellis platform code and cloud/domain code are intentionally separate.

- The Trellis platform repo owns protocol/runtime libraries, the `trellis` runtime service, jobs, Trellis-owned contracts such as `trellis.core@v1` and `trellis.auth@v1`, and contract tooling.
- Cloud repos own domain services, domain contracts, apps, and domain models unless a model is required by a Trellis-owned contract or shared Trellis runtime library.
- `@trellis/trellis` is a runtime library, not a central registry for every service API.
- Service APIs are defined with the service that owns them and consumed through contract packages.

#### Category Responsibilities

| Category       | Mounts RPCs | Publishes Events | Subscribes Events | Owns Storage |
| -------------- | ----------- | ---------------- | ----------------- | ------------ |
| Infrastructure | Yes         | No               | No                | KV only      |
| Ingest         | No          | Yes              | Maybe             | Sync state   |
| Repository     | Yes         | Maybe            | Yes               | Yes          |
| Processing     | Maybe       | Yes              | Yes               | No           |
| Egress         | No          | No               | Yes               | Sync state   |

### Communication Patterns

#### Events (JetStream Pub/Sub)

Events announce state changes. Publishers fire and forget.

**Subject naming:** `events.v1.<Domain>.<...tokens>`

```
events.v1.Partner.Changed.<origin>.<id>
events.v1.Identity.Changed.<origin>.<id>
events.v1.User.Authenticated
```

**Filtering with subject tokens:**

Add tokens when:

1. Consumers need selective subscriptions (subscribe to `events.v1.Document.Uploaded.pdf` instead of filtering in-handler)
2. Cardinality is bounded (document types, partner IDs—not user-generated strings)
3. Values are stable (IDs, types, event names—not mutable entity state). Event types like `Created` or `Completed` are fine; they represent immutable facts, not current status.

```
events.v1.Document.Uploaded.<contentType>.<partnerId>
events.v1.Document.Uploaded.pdf.partner-123
events.v1.Document.Uploaded.*.partner-123     # All types for partner
events.v1.Document.Uploaded.pdf.*             # All partners, PDFs only
```

**Trade-offs:**

- More tokens enable flexible filtering but lengthen subjects
- Token order matters: put most-filtered tokens first for efficient wildcards

**Delivery guarantees:**

- JetStream durable consumers with at-least-once delivery
- Handlers must be idempotent

**Publishers:** Ingest (external data arrives), Processing (enrichment completes), Repository (cache invalidation)

#### RPCs (Request/Reply)

RPCs query data or perform synchronous operations.

**Subject naming:** Domain-based, not service-based:

```
rpc.v1.User.Find
rpc.v1.Partner.List
rpc.v1.Documents.Search
```

Callers use method names (e.g. `trellis.request("User.Find", args)`), not subjects. The API schema maps methods to subjects (including a `v1` prefix), allowing implementation changes without breaking callers.

---

## Core Libraries

| Library                 | Purpose                                          | Use when                       |
| ----------------------- | ------------------------------------------------ | ------------------------------ |
| `@trellis/trellis`      | Client runtime for RPC/events                    | Frontend apps, CLI tools       |
| `@trellis/server`       | Runtime-neutral server core                      | Backend services               |
| `@trellis/server/node`  | Node server runtime adapter                      | External Node services         |
| `@trellis/server/deno`  | Deno server runtime adapter                      | In-repo Deno services          |
| `@trellis/result`       | Result type for explicit error handling          | Any function that can fail     |
| `@trellis/auth`         | Session key management and browser/session auth  | Services, apps, CLI tools      |
| `@trellis/auth/protocol`| Public auth/admin wire DTOs                      | Apps, services, docs, tests    |
| `@trellis/contracts`    | Contract authoring and shared protocol primitives| Services, SDK/docs generation  |
| `@trellis/telemetry`    | Shared tracing helpers                           | Runtime libraries and services |
| `@trellis/jobs`         | Job creation and processing                      | Long-running or retryable work |

### @trellis/trellis

Client runtime for RPC/event communication over NATS. Auth is injected from `@trellis/auth-*` packages.

#### Client (Browser)

```typescript
// Browser auth uses a session key stored in IndexedDB (WebCrypto) plus an OAuth bind flow.
// After bind, connect to NATS with sentinel creds + auth callout token (see adr-trellis-auth.md).
//
// For SvelteKit apps, prefer the higher-level helpers in `@trellis/svelte` which handle:
// - bind callback processing
// - wsconnect
// - immediate + periodic binding token renewal
```

#### Client (Deno/Node)

```typescript
import { defineContract } from "@trellis/contracts";
import { auth } from "@trellis/sdk-auth";
import { graph } from "@acme/graph-contract";

const cli = defineContract({
  id: "acme.graph-cli@v1",
  displayName: "Graph CLI",
  description: "Query the graph service and inspect auth state.",
  kind: "cli",
  uses: {
    auth: auth.use({ rpc: { call: ["Auth.Me"] } }),
    graph: graph.use({ rpc: { call: ["Graph.Query"] } }),
  },
});

const client = createClient(cli, nc, authSession, {
  name: "cli-tool",
});
```

#### Server

```typescript
import { connect } from "@nats-io/transport-deno";
import { TrellisServer } from "@trellis/server";

const nc = await connect({ servers: config.nats.servers });
const server = TrellisServer.create("graph", nc, auth, { log });

server.mount("User.Find", async (input, ctx) => {
  const user = await db.findUser(input.userId);
  if (!user) return Result.err(new NotFoundError("User"));
  return Result.ok({ user });
});

// See other services for event consumption patterns.
```

#### Contract

- RPCs are timeout-bounded (default: 5s)
- Both sides use `Result<T, E>` — errors are values, not exceptions
- RPC/event schemas validate inputs and outputs at runtime

### @trellis/result

Explicit error handling via `Result<T, E>`. See [Result Type](#result-type).

### @trellis/auth

Session key loading, signing, browser bind flow helpers, and shared auth support code. Public auth/admin wire DTOs live under `@trellis/auth/protocol`. See [adr-trellis-auth.md](./adr-trellis-auth.md).

### @trellis/telemetry

Shared tracing helpers used by `@trellis/trellis`, `@trellis/server`, and future packages like `@trellis/jobs`.

### @trellis/jobs

Job queue with retry, progress tracking, and DLQ. See [adr-trellis-jobs.md](./adr-trellis-jobs.md).

### @trellis/contracts

Contract tooling for manifest validation, canonicalization, SDK generation, and documentation export. It may also provide language-specific authoring helpers that emit the same canonical manifest. See [adr-trellis-contracts-catalog.md](./adr-trellis-contracts-catalog.md).

---

## Storage

### NATS KV

#### Bucket Naming

`trellis_<domain>` — lowercase, underscores. Examples: `trellis_sessions`, `trellis_jobs`, `trellis_users`.

#### Key Structure

Use `.` delimiter for wildcard support:

```

<domain>.<qualifiers...>.<identifier>

```

**Key segments must be NATS subject-safe:** No `.` `*` `>` or whitespace within segments. Use base64url (no padding) for binary data.

**Identifiers:** Use ULIDs unless there's a good reason not to. ULIDs are sortable, URL-safe, and subject-safe.

Examples:

- `github.12345.abc123` — session keyed by origin, user ID, session key
- `graph.transcription.01ARZ3NDEK` — job keyed by service, type, job ID

**Design keys for query patterns:**

| Query need               | Key pattern          | Lookup                    |
| ------------------------ | -------------------- | ------------------------- |
| By ID only               | `<id>`               | Direct get                |
| By owner + ID            | `<owner>.<id>`       | `keys("<owner>.*")`       |
| By category + owner + ID | `<cat>.<owner>.<id>` | `keys("<cat>.<owner>.*")` |
| By ID with qualifiers    | `<cat>.<owner>.<id>` | `keys("*.*.<id>")`        |

Wildcard lookups by ID (`*.*.<id>`) work when you know the ID but not the qualifiers. This enables ID-only APIs while preserving filtered iteration.

#### TTL Tiers

| Tier      | TTL   | Use case                        |
| --------- | ----- | ------------------------------- |
| Ephemeral | 5 min | OAuth state, binding tokens     |
| Session   | 24h   | User sessions, connections      |
| Permanent | None  | Users, services, reference data |

Set `max_age` on bucket creation. Write full value on update to reset TTL.

#### Projections

| Pattern           | Use when                                                |
| ----------------- | ------------------------------------------------------- |
| Direct write      | Simple CRUD, no audit trail needed                      |
| Stream projection | Need event history, replay, or cross-service visibility |

Projections: consume stream with durable consumer, write derived state to KV. The stream is source of truth; KV is a read-optimized view.

---

## Type System

### API Schema

Each service owns a local contract definition that emits the canonical `trellis.contract.v1` release artifact. The local authoring experience may differ by language; the example below shows one TypeScript shape.

```typescript
import { defineContract } from "@trellis/contracts";
import { core } from "@trellis/sdk-core";

export const contract = defineContract({
  id: "graph@v1",
  displayName: "Graph Service",
  description: "Serve graph RPCs and publish partner change events.",
  kind: "service",
  uses: {
    trellis: core.use({ rpc: { call: ["Trellis.Catalog"] } }),
  },
  rpc: {
    "User.Find": {
      version: "v1",
      inputSchema: FindUserSchema,
      outputSchema: UserSchema,
      errors: ["NotFound"],
      capabilities: { call: ["users.read"] },
    },
  },
  events: {
    "Partner.Changed": {
      version: "v1",
      params: ["/partner/id/origin", "/partner/id/id"],
      eventSchema: PartnerEventSchema,
      capabilities: {
        publish: ["partners.write"],
        subscribe: ["partners.read"],
      },
    },
  },
});

export const { API, CONTRACT, CONTRACT_DIGEST, CONTRACT_ID, use } = contract;
```

The local contract source defines input/output types, allowed errors, required capabilities, subject-token parameters, and explicit cross-contract dependencies. The emitted manifest is what the `trellis` runtime, catalogs, and cross-language tooling consume.

### Schema Validation

Use TypeBox and Zod for their respective strengths:

| Library | Use Case                     | Rationale                                 |
| ------- | ---------------------------- | ----------------------------------------- |
| TypeBox | RPC schemas, event payloads  | Type inference, JSON Schema compatibility |
| Zod     | Service config (ENV parsing) | Ergonomic transforms, coercion, defaults  |

**TypeBox for RPC:**

```typescript
import { type Static, Type } from "@sinclair/typebox";

export const FindUserSchema = Type.Object({
  userId: TrellisIDSchema,
});
export type FindUserInput = Static<typeof FindUserSchema>;
```

**Zod for config:**

```typescript
import { z } from "zod";

const configSchema = z.object({
  ARANGO_URL: z.string().url(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const config = configSchema.parse({
  ARANGO_URL: Deno.env.get("ARANGO_URL"),
  LOG_LEVEL: Deno.env.get("LOG_LEVEL"),
});
```

**Guidelines:**

- TypeBox for RPC schemas (standard across services)
- Zod for ENV parsing (better coercion and defaults)
- One validation library per use case

### Result Type

All RPC handlers return `Result<T, E>` from `@trellis/result`. Benefits:

- **Explicit errors** — Errors are values, not exceptions
- **Chaining** — Transform with `map`, `mapErr`, `andThen`
- **Type narrowing** — `take()` pattern for early returns

### Error Handling

Trellis-shared errors come from `@trellis/trellis`. Service-specific errors may extend the same base locally and are declared in the owning service contract:

```typescript
export class AuthError extends TrellisError<AuthErrorData> {
  override readonly name = "AuthError" as const;
  readonly reason: AuthErrorData["reason"];

  constructor(options: ErrorOptions & { reason: AuthErrorData["reason"] }) {
    super(options);
    this.reason = options.reason;
  }

  override toSerializable(): AuthErrorData {
    return { type: this.name, message: this.message, reason: this.reason };
  }
}
```

Each error defines:

- Unique `name` constant for discrimination
- `DataSchema` for serialization
- `toSerializable()` for RPC transmission

The on-wire error envelope is open:

- Trellis-shared errors are documented and may have shared schemas
- service-specific error types do not require adding them to a global core registry
- runtimes must preserve unknown error payloads for diagnostics and typed packages may narrow only the types they know about

---

## Service Development

### Directory Structure

```
services/<name>/
├── main.ts          # Bootstrap, handlers, shutdown
├── contract.ts      # Service-owned contract definition
├── config.ts        # Environment configuration
├── globals.ts       # Shared runtime state (NATS connection, logger, config, db)
├── deno.json        # Tasks, imports
└── <domain>.ts      # Business logic
```

### Lifecycle

```typescript
import { connectService } from "@trellis/server/deno";
import { myService } from "./contract.ts";

// 1. Connect, verify contract, and resolve bindings
const service = await connectService(myService, "<name>", {
  sessionKeySeed: config.sessionKeySeed,
  nats: {
    servers: config.nats.servers,
    sentinelCredsPath: config.nats.sentinelCredsPath,
  },
  server: {},
});

// 2. Open KV stores from resolved bindings
const itemsKV = (await service.kv.items.open(ItemSchema)).take();

// 3. Mount handlers and subscribe to events
await service.trellis.mount("SomeMethod", handler);
await service.trellis.event("SomeEvent", {}, eventHandler);

// 4. Graceful shutdown
Deno.addSignalListener("SIGTERM", async () => {
  await service.stop();
  Deno.exit(0);
});
```

`connectService` handles NATS connection, auth handshake, contract verification against the active catalog, and resource binding resolution. If the contract is not installed, it fails immediately with a clear error.

The `trellis` control-plane service is the one explicit exception. Because it mounts `Trellis.Catalog` and `Trellis.Bindings.Get` itself, it cannot preflight against those RPCs during startup. That bootstrap path is Trellis-specific platform code and should use lower-level runtime APIs directly rather than introducing a special public service helper.

### Observability

Every service exposes:

- `<Service>.Health` RPC (automatic)
- `<Service>.Stats` RPC (optional)
- OpenTelemetry tracing (automatic)
- Structured logging via pino

**Health RPC:**

`TrellisServer` provides automatic health endpoints. Register custom checks during setup:

```typescript
const server = await TrellisServer.connect("graph", {
  auth,
  natsServers: config.nats.servers,
  log,
  healthChecks: {
    db: () => db.ping(),
  },
});
```

The server exposes `Graph.Health` automatically, combining NATS status with registered checks.

**Stats RPC:**

```typescript
server.mount("Graph.Stats", async () => {
  return Result.ok({
    users: { count: await db.countUsers() },
    partners: { count: await db.countPartners() },
  });
});
```

---

## Development Standards

### Schema Organization

Platform-wide schemas live in the Trellis platform repo only when they are reused by Trellis-owned contracts or shared Trellis runtime libraries. Service-specific and domain-specific schemas live with the service or cloud package that owns them.

The `trellis` runtime service may implement multiple logical contracts, but those contracts still follow the same ownership and co-location rules as any other service contract.

Typical platform layout:

```
libs/trellis/models/
├── <domain>/
│   ├── models/     # Entity schemas (User.ts, Partner.ts)
│   ├── rpc/        # RPC schemas (CreateIdentity.ts)
│   └── events/     # Event schemas (IdentityEvent.ts)
└── index.ts        # Re-exports
```

**Naming:**

```typescript
// Schema: <Name>Schema
export const UserSchema = Type.Object({
  id: Type.String(),
  active: Type.Boolean({ default: true }),
});

// Type: <Name> (no suffix)
export type User = Static<typeof UserSchema>;
```

**Guidelines:**

- One schema per file, named after the type
- Events combine `EventHeaderSchema` with payload via `Type.Intersect()`
- Simple RPC schemas pair input/response in one file; complex operations use separate files
- Service-specific schemas stay in the service directory

### Documentation

Exported functions, classes, and methods require JSDoc. Focus on public APIs in `libs/`—document internal handlers only when logic is non-obvious.

**Required:**

- Brief purpose description
- `@param` for each parameter
- `@returns` description
- `@throws` or `@errors` for error conditions
- `@example` for complex usage

```typescript
/**
 * Parses and validates JSON data against a TypeBox schema.
 *
 * @param schema - TypeBox schema to validate against
 * @param data - Raw JSON value to parse
 * @returns Result containing the parsed value or a ValidationError
 *
 * @example
 * const result = parse(UserSchema, { id: "123", active: true });
 * if (result.isOk()) {
 *   console.log(result.value.id);
 * }
 */
export function parse<T extends TSchema>(
  schema: T,
  data: JsonValue,
): Result<StaticDecode<T>, ValidationError | UnexpectedError> {
  // ...
}
```

**Skip JSDoc for:** private functions (but still include a brief description), self-documenting one-liners, tests.

### Tracing

`TrellisServer.connect()` initializes OpenTelemetry automatically using the service name.

**Span naming:**

- RPC client: `rpc.client.<MethodName>`
- RPC server: `rpc.server.<MethodName>`
- Event publish: `event.publish.<Domain>.<Action>`
- Event handle: `event.handle.<Domain>.<Action>`

**Required attributes:** `rpc.system`, `rpc.method`, `messaging.destination`

**Library support:**

Libraries performing I/O must accept trace context via `HeaderCarrier`, create child spans, and propagate context:

```typescript
import { getTrellisTracer } from "@trellis/telemetry/trellis";
import { withSpanAsync } from "@trellis/telemetry";

export async function fetchDocument(id: string): Promise<Document> {
  const span = getTrellisTracer().startSpan("document.fetch");
  return withSpanAsync(span, async () => {
    span.setAttribute("document.id", id);
    // ...
  });
}
```

All `TrellisError` subclasses include `traceId` when tracing is active.

### Request Correlation

Every RPC and event includes a `requestId` for correlation and audit.

**Generation:** Server generates a new ULID for each incoming RPC. Any client-provided `request-id` header is ignored — clients cannot influence the authoritative requestId.

**Propagation:**

| Context                  | `request-id` value              |
| ------------------------ | ------------------------------- |
| RPC handler              | Generated on receipt            |
| RPC response             | Echoed from handler             |
| Event from RPC           | Inherited from triggering RPC   |
| Event from event handler | Inherited from triggering event |
| Scheduled/cron event     | New ULID                        |

**Audit requirements:**

- State-changing operations emit events to JetStream
- Events persist with configurable retention for audit trail
- `requestId` enables correlation: RPC → events → downstream effects
- Logs and tracing include `requestId` for full correlation

**Event deduplication:**

- Events include `Nats-Msg-Id: <requestId>` header
- JetStream deduplicates within configurable window (default 2 min)
- Protects against duplicate event publication on retries/reconnects

---

## Frontend (Svelte)

Conductor uses Svelte 5 runes for reactive state:

```typescript
class Auth {
  #state: AuthState = $state({ handle: null, nonce: null });

  get handle() {
    return this.#state.handle;
  }

  async signIn(provider: string): Promise<void> {
    // mutate #state, reactivity propagates automatically
  }
}

export const authState = new Auth();
```

**Patterns:**

- Private `#state` field with `$state()` rune
- Public getters, no setters
- Methods for mutations
- Static factory methods for async initialization

---

## Authorization

See [adr-trellis-auth.md](./adr-trellis-auth.md) for role enforcement, session management, and access token validation.

### Capabilities and Roles

Contracts declare per-operation capability requirements. Deployments grant those capabilities through roles, groups, or external identity mappings.

During the current transition some capability strings may still use role-shaped names such as `users:read`, but the architecture is contract-driven and capability-oriented.

| Pattern             | Example          | Meaning                     | Who Can Claim   |
| ------------------- | ---------------- | --------------------------- | --------------- |
| `<domain>.<action>` | `users.read`     | Can read users              | Users, Services |
| `<domain>.<action>` | `partners.write` | Can mutate partners         | Users, Services |
| `service`           | —                | Backend service             | Services only   |
| `admin`             | —                | Administrative access       | Users, Services |
| `<domain>.<verb>`   | `jobs.publish`   | Publish to jobs subsystem   | Users, Services |
| `<domain>.<verb>`   | `jobs.subscribe` | Subscribe to jobs subsystem | Users, Services |

**Service-only requirements:** Some operations still require the caller to be a registered service in addition to holding the needed capabilities. Auth enforces that using service identity plus the active contract set.

**Assignment:**

- Contracts declare required capabilities
- Deployments assign roles/capability bundles to users and services
- Services receive their deployment policy at installation and contract upgrade time

Authorization changes take effect immediately because Auth derives NATS subjects from the deployment's active contracts and current grants.

**Future:** richer capability bundles and role composition remain deployment policy, not protocol surface.

---
