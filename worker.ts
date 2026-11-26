import { Container, getContainer } from '@cloudflare/containers';
import { runScheduledModelSync } from './server/modelSync/scheduledSync';

type ContainerCtorArgs = ConstructorParameters<typeof Container<Env>>;

export interface Env {
  LYRA_CONTAINER: Parameters<typeof getContainer<LyraContainer>>[0];
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  BETTER_AUTH_SECRET?: string;
  LYRA_GATEWAY_API_KEY?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  AZURE_FOUNDRY_ENDPOINT?: string;
  AZURE_FOUNDRY_API_KEY?: string;
  AZURE_FOUNDRY_API_VERSION?: string;
  OPENROUTER_API_KEY?: string;
  DATABASE_URL?: string;
  LYRA_DATABASE_URL?: string;
  LYRA_DATABASE_HOST?: string;
  LYRA_DATABASE_PORT?: string;
  LYRA_DATABASE_NAME?: string;
  LYRA_DATABASE_USER?: string;
  LYRA_DATABASE_PASSWORD?: string;
  LYRA_DATABASE_SSL?: string;
}

export class LyraContainer extends Container<Env> {
  override defaultPort = 3001;
  override sleepAfter = '30m';
  override enableInternet = true;

  constructor(ctx: ContainerCtorArgs[0], env: Env) {
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
      ...(env.AZURE_FOUNDRY_ENDPOINT ? { AZURE_FOUNDRY_ENDPOINT: env.AZURE_FOUNDRY_ENDPOINT } : {}),
      ...(env.AZURE_FOUNDRY_API_KEY ? { AZURE_FOUNDRY_API_KEY: env.AZURE_FOUNDRY_API_KEY } : {}),
      ...(env.AZURE_FOUNDRY_API_VERSION ? { AZURE_FOUNDRY_API_VERSION: env.AZURE_FOUNDRY_API_VERSION } : {}),
      ...(env.OPENROUTER_API_KEY ? { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY } : {}),
      ...(env.DATABASE_URL ? { DATABASE_URL: env.DATABASE_URL } : {}),
      ...(env.LYRA_DATABASE_URL ? { LYRA_DATABASE_URL: env.LYRA_DATABASE_URL } : {}),
      ...(env.LYRA_DATABASE_HOST ? { LYRA_DATABASE_HOST: env.LYRA_DATABASE_HOST } : {}),
      ...(env.LYRA_DATABASE_PORT ? { LYRA_DATABASE_PORT: env.LYRA_DATABASE_PORT } : {}),
      ...(env.LYRA_DATABASE_NAME ? { LYRA_DATABASE_NAME: env.LYRA_DATABASE_NAME } : {}),
      ...(env.LYRA_DATABASE_USER ? { LYRA_DATABASE_USER: env.LYRA_DATABASE_USER } : {}),
      ...(env.LYRA_DATABASE_PASSWORD ? { LYRA_DATABASE_PASSWORD: env.LYRA_DATABASE_PASSWORD } : {}),
      ...(env.LYRA_DATABASE_SSL ? { LYRA_DATABASE_SSL: env.LYRA_DATABASE_SSL } : {}),
    };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.LYRA_CONTAINER, 'primary-v10');
    return container.fetch(request);
  },

  /** Daily Cron Trigger (see cloudflare.config.ts): wakes the container and runs the model sync. */
  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    const container = getContainer(env.LYRA_CONTAINER, 'primary-v10');
    ctx.waitUntil(runScheduledModelSync((request) => container.fetch(request), env));
  },
};
