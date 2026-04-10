export { default as TrellisProvider } from "./components/TrellisProvider.svelte";
export { createTrellisApp, getAuth, getNats, getNatsState, setTrellisContext } from "./context.svelte.ts";
export type { BoundTrellisApp } from "./context.svelte.ts";
export { createPortalFlow, PortalFlowController, type CreatePortalFlowConfig } from "./portal_flow.svelte.ts";
export { AuthState, type BindErrorResult, type BindResult, createAuthState, type SignInOptions } from "./state/auth.svelte.ts";
export type { NatsStateConfig, Status as NatsStatus } from "./state/nats.svelte.ts";
export { createNatsState, NatsState } from "./state/nats.svelte.ts";
export type { TrellisClientContract, TrellisStateConfig } from "./state/trellis.svelte.ts";
export { createTrellisState, TrellisState } from "./state/trellis.svelte.ts";
