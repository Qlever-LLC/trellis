export type ActivationCallbackState = {
  flowId: string;
  callbackToken: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PRESERVED_ACTIVATION_FLOW_ID_STORAGE_KEY = "portal.activate.flowId";
const ACTIVATION_CALLBACK_TOKEN_STORAGE_KEY = "portal.activate.callbackToken";
const ACTIVATION_CALLBACK_QUERY_PARAM = "portalCallback";

export function buildActivationCallbackPath(currentUrl: URL, callbackToken: string): string {
  const callbackUrl = new URL(currentUrl.pathname, currentUrl.origin);
  callbackUrl.searchParams.set(ACTIVATION_CALLBACK_QUERY_PARAM, callbackToken);
  callbackUrl.hash = currentUrl.hash;
  return `${callbackUrl.pathname}${callbackUrl.search}${callbackUrl.hash}`;
}

export function getPreservedActivationCallbackState(storage: StorageLike): ActivationCallbackState | null {
  const flowId = storage.getItem(PRESERVED_ACTIVATION_FLOW_ID_STORAGE_KEY);
  const callbackToken = storage.getItem(ACTIVATION_CALLBACK_TOKEN_STORAGE_KEY);

  if (!flowId || !callbackToken) return null;

  return { flowId, callbackToken };
}

export function preserveActivationCallbackState(
  storage: StorageLike,
  nextState: ActivationCallbackState,
): void {
  storage.setItem(PRESERVED_ACTIVATION_FLOW_ID_STORAGE_KEY, nextState.flowId);
  storage.setItem(ACTIVATION_CALLBACK_TOKEN_STORAGE_KEY, nextState.callbackToken);
}

export function clearPreservedActivationCallbackState(storage: StorageLike): void {
  storage.removeItem(PRESERVED_ACTIVATION_FLOW_ID_STORAGE_KEY);
  storage.removeItem(ACTIVATION_CALLBACK_TOKEN_STORAGE_KEY);
}

export function shouldHandleActivationAuthCallback(
  currentUrl: URL,
  preservedState: ActivationCallbackState | null,
): boolean {
  if (!preservedState) return false;
  if (currentUrl.searchParams.get(ACTIVATION_CALLBACK_QUERY_PARAM) !== preservedState.callbackToken) {
    return false;
  }

  return currentUrl.searchParams.has("flowId") || currentUrl.searchParams.has("authError");
}
