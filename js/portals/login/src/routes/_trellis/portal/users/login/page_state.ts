function isSamePageLocation(currentUrl: URL, location: string | null): boolean {
  if (!location) return false;

  const nextUrl = new URL(location, currentUrl);
  return `${nextUrl.origin}${nextUrl.pathname}${nextUrl.search}` ===
    `${currentUrl.origin}${currentUrl.pathname}${currentUrl.search}`;
}

type LocalLoginSuccess = {
  status: "authenticated";
  flowId: string;
};

type LocalLoginFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type LocalRegistrationFetch = LocalLoginFetch;

type LocalLoginRequestRecord = {
  flowId: string;
  username: string;
  password: string;
};

type LocalRegistrationRequestRecord = {
  username: string;
  password: string;
  name: string;
  email: string;
};

type RegistrationProvider = {
  id: string;
  displayName: string;
};

type RegistrationOptions = {
  localIdentity?: { available?: unknown };
  federatedIdentity?: {
    available?: unknown;
    providers?: unknown;
  };
};

type RegistrationFlowState = {
  status?: unknown;
  registration?: RegistrationOptions;
};

function localLoginUrl(trellisUrl: string): URL {
  return new URL("/auth/login/local", trellisUrl);
}

function localRegistrationUrl(trellisUrl: string, flowId: string): URL {
  return new URL(
    `/auth/flow/${encodeURIComponent(flowId)}/register/local`,
    trellisUrl,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function responseErrorCode(response: Response): Promise<string | null> {
  try {
    const body = await response.json();
    return isRecord(body) && typeof body.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

export function localLoginErrorMessage(
  status: number,
  errorCode: string | null,
): string {
  if (errorCode === "invalid_credentials") {
    return "Invalid username or password.";
  }
  if (errorCode === "user_inactive") {
    return "This account is inactive. Contact an administrator for access.";
  }
  if (status === 404) {
    return "This sign-in request has expired. Return to the app and start sign-in again.";
  }
  if (status === 400) return "Unable to submit this sign-in request.";
  return "Unable to sign in. Please try again.";
}

export function localRegistrationErrorMessage(
  status: number,
  errorCode: string | null,
): string {
  if (errorCode === "username_taken") {
    return "That username is already in use.";
  }
  if (errorCode === "email_taken") {
    return "That email is already in use.";
  }
  if (errorCode === "registration_unavailable") {
    return "Account creation is not available for this sign-in request.";
  }
  if (status === 404) {
    return "This sign-in request has expired. Return to the app and start sign-in again.";
  }
  if (status === 400) return "Unable to create this account.";
  return "Unable to create account. Please try again.";
}

export function isLocalRegistrationAvailable(flowState: unknown): boolean {
  if (!isRecord(flowState) || flowState.status !== "choose_provider") {
    return false;
  }
  const registration = (flowState as RegistrationFlowState).registration;
  return registration?.localIdentity?.available === true;
}

export function federatedRegistrationProviders(
  flowState: unknown,
): RegistrationProvider[] {
  if (!isRecord(flowState) || flowState.status !== "choose_provider") {
    return [];
  }
  const registration = (flowState as RegistrationFlowState).registration;
  const federatedIdentity = registration?.federatedIdentity;
  if (federatedIdentity?.available !== true) return [];
  if (!Array.isArray(federatedIdentity.providers)) return [];
  return federatedIdentity.providers.filter(
    (provider): provider is RegistrationProvider =>
      isRecord(provider) &&
      typeof provider.id === "string" &&
      typeof provider.displayName === "string",
  );
}

export function isFederatedRegistrationAvailable(flowState: unknown): boolean {
  if (!isRecord(flowState) || flowState.status !== "choose_provider") {
    return false;
  }
  const registration = (flowState as RegistrationFlowState).registration;
  return registration?.federatedIdentity?.available === true;
}

export function isFederatedRegistrationProvider(
  flowState: unknown,
  providerId: string,
): boolean {
  return federatedRegistrationProviders(flowState).some((provider) =>
    provider.id === providerId
  );
}

export async function submitLocalLogin(
  trellisUrl: string,
  request: LocalLoginRequestRecord,
  fetchFn: LocalLoginFetch = fetch,
): Promise<LocalLoginSuccess> {
  const response = await fetchFn(localLoginUrl(trellisUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(
      localLoginErrorMessage(
        response.status,
        await responseErrorCode(response),
      ),
    );
  }

  const body: unknown = await response.json();
  if (
    !isRecord(body) ||
    body.status !== "authenticated" ||
    body.flowId !== request.flowId
  ) {
    throw new Error("Unable to sign in. Please try again.");
  }

  return { status: "authenticated", flowId: request.flowId };
}

export async function submitLocalRegistration(
  trellisUrl: string,
  flowId: string,
  request: LocalRegistrationRequestRecord,
  fetchFn: LocalRegistrationFetch = fetch,
): Promise<void> {
  const response = await fetchFn(localRegistrationUrl(trellisUrl, flowId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(
      localRegistrationErrorMessage(
        response.status,
        await responseErrorCode(response),
      ),
    );
  }
}

export function shouldStayOnPortalCompletionPage(
  currentUrl: URL,
  redirectLocation: string | null,
): boolean {
  return isSamePageLocation(currentUrl, redirectLocation);
}

export function shouldOfferPortalReturnLink(
  currentUrl: URL,
  returnLocation: string | null | undefined,
): boolean {
  if (!returnLocation) return false;
  return !isSamePageLocation(currentUrl, returnLocation);
}
