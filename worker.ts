import { Container, getContainer } from '@cloudflare/containers';

export interface Env {
  LYRA_CONTAINER: DurableObjectNamespace<LyraContainer>;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  BETTER_AUTH_SECRET?: string;
  LYRA_GATEWAY_API_KEY?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
}

export class LyraContainer extends Container<Env> {
  defaultPort = 3001;
  sleepAfter = '30m';
  enableInternet = true;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.envVars = {
      LYRA_HOSTED: 'true',
      BETTER_AUTH_URL: 'https://lyra.2helix.org',
      PORT: '3001',
      ...(env.GOOGLE_CLIENT_ID ? { GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID } : {}),
      ...(env.GOOGLE_CLIENT_SECRET ? { GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET } : {}),
      ...(env.BETTER_AUTH_SECRET ? { BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET } : {}),
      ...(env.LYRA_GATEWAY_API_KEY ? { LYRA_GATEWAY_API_KEY: env.LYRA_GATEWAY_API_KEY } : {}),
      ...(env.AWS_ACCESS_KEY_ID ? { AWS_ACCESS_KEY_ID: env.AWS_ACCESS_KEY_ID } : {}),
      ...(env.AWS_SECRET_ACCESS_KEY ? { AWS_SECRET_ACCESS_KEY: env.AWS_SECRET_ACCESS_KEY } : {}),
      ...(env.AWS_REGION ? { AWS_REGION: env.AWS_REGION } : {}),
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.LYRA_CONTAINER, 'primary-v5');
    return container.fetch(request);
  },
};
