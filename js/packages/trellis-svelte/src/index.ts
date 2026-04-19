export { default as TrellisProvider } from "./components/TrellisProvider.svelte";
export { getAuth, getConnectionState, getTrellis } from "./context.svelte.ts";
export type { ConnectionState, PublicTrellis, TrellisContractLike } from "./context.svelte.ts";
export { createPortalFlow, PortalFlowController, type CreatePortalFlowConfig } from "./portal_flow.svelte.ts";
export { AuthState, type BindErrorResult, type BindResult, createAuthState, type SignInOptions } from "./state/auth.svelte.ts";
export type { TrellisClientContract } from "./state/trellis.svelte.ts";
