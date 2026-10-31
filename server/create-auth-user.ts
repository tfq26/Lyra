import { initializeBetterAuth } from './betterAuth';

async function main() {
  const name = process.env.LYRA_BOOTSTRAP_USER_NAME?.trim();
  const email = process.env.LYRA_BOOTSTRAP_USER_EMAIL?.trim();
  const password = process.env.LYRA_BOOTSTRAP_USER_PASSWORD;
  if (!name || !email || !password) throw new Error('Set LYRA_BOOTSTRAP_USER_NAME, LYRA_BOOTSTRAP_USER_EMAIL, and LYRA_BOOTSTRAP_USER_PASSWORD for this one-time account provisioning command.');
  if (password.length < 12) throw new Error('Use a bootstrap password with at least 12 characters.');

  // Signup is disabled in the hosted API. This one-shot operator command temporarily
  // enables Better Auth's normal signup endpoint only in this process.
  process.env.LYRA_AUTH_DISABLE_SIGNUP = 'false';
  const runtime = await initializeBetterAuth();
  if (!runtime) throw new Error('Better Auth requires a configured PostgreSQL connection.');
  try {
    const result = await runtime.auth.api.signUpEmail({ body: { name, email, password } });
    if (!result.user) throw new Error('Better Auth did not create a user.');
    process.stdout.write(`Created Lyra account for ${result.user.email}. Complete email verification before signing in.\n`);
  } finally { await runtime.close(); }
}

main().catch((error) => {
  process.stderr.write(`[Lyra account setup] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
