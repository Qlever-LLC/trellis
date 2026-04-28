import type { OAuth2User } from "./oauth2_user.ts";

export abstract class Provider {
  abstract name: string;
  abstract displayName: string;
  abstract issuer: string;
  abstract authorizationEndpoint: string;
  abstract tokenEndpoint: string;
  abstract scope: string;
  abstract supportsDiscovery: boolean;
  abstract supportsPKCE: boolean;

  clientId: string;
  clientSecret: string;
  redirectBase: string;

  constructor(clientId: string, clientSecret: string, redirectBase: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectBase = redirectBase;
  }

  getRedirectUri(): string {
    return `${this.redirectBase}/${this.name}`;
  }

  getUserInfo(token: string): Promise<OAuth2User> {
    throw new Error("getUserInfo not implmented!");
  }
}

export abstract class OAuth2Provider extends Provider {}
export abstract class OIDCProvider extends Provider {}
