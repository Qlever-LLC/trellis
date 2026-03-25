export type NatsAuthTokenV1 = {
  v: 1;
  sessionKey: string;
  sig: string;
  bindingToken?: string;
  iat?: number;
};
