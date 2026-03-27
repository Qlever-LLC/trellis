import type { AuthorizationServer, Client } from "oauth4webapi";
import {
  authorizationCodeGrantRequest,
  ClientSecretPost,
  calculatePKCECodeChallenge,
  discoveryRequest,
  generateRandomCodeVerifier,
  generateRandomState,
  processAuthorizationCodeResponse,
  processDiscoveryResponse,
  processRefreshTokenResponse,
  refreshTokenGrantRequest,
  validateAuthResponse,
} from "oauth4webapi";
import type { OAuth2Provider, OIDCProvider, Provider } from "./providers/index.ts";
import type { OAuth2Tokens } from "./schemas.ts";

export type IdpFlowParams = {
  state: string;
  codeVerifier: string;
};

export async function discoverProviderConfiguration(
  provider: Provider,
): Promise<AuthorizationServer> {
  if (provider.supportsDiscovery) {
    const issuer = new URL(provider.issuer);
    return discoveryRequest(issuer).then((r) =>
      processDiscoveryResponse(issuer, r)
    );
  }
    return {
      issuer: provider.issuer,
      authorization_endpoint: provider.authorizationEndpoint,
      token_endpoint: provider.tokenEndpoint,
    };
}

export async function OAuth2CodeRequest(
  provider: OAuth2Provider | OIDCProvider,
): Promise<[string, IdpFlowParams]> {
  const conf = await discoverProviderConfiguration(provider);
  const state = generateRandomState();
  const codeChallengeMethod = "S256";
  const codeVerifier = generateRandomCodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);

  if (!conf.authorization_endpoint) {
    throw new Error("Missing authorization_endpoint in OAuth config");
  }
  const url = new URL(conf.authorization_endpoint);
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", provider.getRedirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", provider.scope);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", codeChallengeMethod);

  return [url.href, { state, codeVerifier }];
}

export async function OAuth2CodeResponse(
  provider: OAuth2Provider | OIDCProvider,
  url: URL,
  state: string,
  codeVerifier: string,
): Promise<OAuth2Tokens> {
  const as = await discoverProviderConfiguration(provider);
  const client: Client = { client_id: provider.clientId };

  // Get OAuth response and validate it
  const params = validateAuthResponse(as, client, url, state);

  // Get token from code
  const response = await authorizationCodeGrantRequest(
    as,
    client,
    ClientSecretPost(provider.clientSecret),
    params,
    provider.getRedirectUri(),
    codeVerifier,
  );

  const tokens = await processAuthorizationCodeResponse(as, client, response);

  let expires: Date | undefined;
  if (tokens.expires_in) {
    expires = new Date();
    expires.setSeconds(expires.getSeconds() + tokens.expires_in);
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expires,
  };
}

export async function OAuth2Refresh(
  provider: OAuth2Provider | OIDCProvider,
  refreshToken: string,
): Promise<OAuth2Tokens> {
  const as = await discoverProviderConfiguration(provider);
  const client: Client = { client_id: provider.clientId };

  const response = await refreshTokenGrantRequest(
    as,
    client,
    ClientSecretPost(provider.clientSecret),
    refreshToken,
  );

  const result = await processRefreshTokenResponse(as, client, response);

  let expires: Date | undefined;
  if (result.expires_in) {
    expires = new Date();
    expires.setSeconds(expires.getSeconds() + result.expires_in);
  }

  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expires,
  };
}
