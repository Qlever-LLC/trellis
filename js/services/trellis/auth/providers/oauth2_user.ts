export type OAuth2User = {
  provider: string;
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  picture?: string;
  company?: string;
  location?: string;
  updated?: string;
};
