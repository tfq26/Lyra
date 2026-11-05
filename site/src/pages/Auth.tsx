import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Fingerprint, Check, Copy, AlertCircle, HelpCircle } from 'lucide-react';
import { authClient, useSession, signInEmail, signUpEmail, signOutUser } from '../lib/auth-client';

export const Auth: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin';
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeyNotice, setPasskeyNotice] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  const navigate = useNavigate();
  const { data: session, isPending } = useSession();

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'signup') {
        const res = await signUpEmail({
          email: email.trim(),
          password,
          name: name.trim() || email.split('@')[0] || 'User',
        });
        if (res.error) {
          setError(res.error.message || 'Failed to sign up');
        } else {
          navigate('/');
        }
      } else {
        const res = await signInEmail({
          email: email.trim(),
          password,
        });
        if (res.error) {
          setError(res.error.message || 'Invalid email or password');
        } else {
          navigate('/');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeySignIn = async () => {
    setError(null);
    setPasskeyNotice(null);
    setLoading(true);

    try {
      // Better-auth passkey signIn
      const res = await authClient.signIn.passkey();
      if (res.error) {
        setError(res.error.message || 'Passkey authentication was cancelled or failed.');
      } else {
        navigate('/');
      }
    } catch (err: any) {
      console.warn('Passkey sign in:', err);
      setError(err?.message || 'No registered passkey found on this device. Sign in with email first to register your passkey.');
    } finally {
      setLoading(false);
    }
  };

  // If user is already authenticated, show account sync & management card
  if (!isPending && session?.user) {
    const sessionToken = (session as any).session?.token || (session as any).token || 'lyra_session_active';

    const handleCopySyncToken = () => {
      navigator.clipboard.writeText(sessionToken);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 3000);
    };

    const handleRegisterPasskey = async () => {
      setPasskeyNotice(null);
      setError(null);
      try {
        const res = await authClient.passkey.addPasskey({
          name: `${navigator.platform || 'Device'} Passkey (${new Date().toLocaleDateString()})`
        });
        if (res.error) {
          setError(res.error.message || 'Failed to register passkey.');
        } else {
          setPasskeyNotice('Passkey registered successfully! You can now sign in with Touch ID / Face ID.');
        }
      } catch (err: any) {
        setError(err?.message || 'Passkey registration cancelled.');
      }
    };

    return (
      <div className="max-w-md mx-auto py-8 apple-fade">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.05] border border-white/[0.1] text-zinc-300 mb-4">
            <span className="text-xl">✱</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white font-display">ACCOUNT SYNC</h1>
          <p className="text-xs text-zinc-400 mt-1">Manage your cloud credentials and synced extensions</p>
        </div>

        <div className="clean-card p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-white/[0.08]">
            <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-semibold text-white">
              {((session.user.name || session.user.email || 'U')[0] ?? 'U').toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-medium text-white">{session.user.name || 'Developer'}</div>
              <div className="text-xs text-zinc-400">{session.user.email}</div>
            </div>
          </div>

          {passkeyNotice && (
            <div className="p-3 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0" />
              <span>{passkeyNotice}</span>
            </div>
          )}

          {error && (
            <div className="p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* VS Code Extension 1-Click Sync */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Sync with VS Code</span>
              <span className="text-[10px] text-zinc-500">Universal AHP Session</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Use this cloud session token to authenticate your VS Code extension and Antigravity IDE:
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopySyncToken}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded bg-white text-black font-medium text-xs hover:bg-zinc-200 transition-colors"
              >
                {copiedToken ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-black" />
                    <span>Token Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy Sync Token for Extension</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">
              Run <code className="text-zinc-300">Cmd+Shift+P</code> → <code className="text-zinc-300">Lyra: Sign In to Account</code> in VS Code and paste this token.
            </p>
          </div>

          {/* Passkey Setup */}
          <div className="pt-4 border-t border-white/[0.08] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Passkey Authentication</span>
              <Fingerprint className="h-3.5 w-3.5 text-zinc-500" />
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Register biometric login (Touch ID, Face ID, or Security Key) for instant 1-click passwordless sign in.
            </p>
            <button
              onClick={handleRegisterPasskey}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded bg-zinc-800 border border-white/[0.08] text-zinc-200 font-medium text-xs hover:bg-zinc-700 transition-colors"
            >
              <Fingerprint className="h-3.5 w-3.5 text-zinc-400" />
              <span>Register Device Passkey (Face ID / Touch ID)</span>
            </button>
          </div>

          <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between">
            <Link to="/" className="text-xs text-zinc-400 hover:text-white transition-colors">
              ← Back to Overview
            </Link>
            <button
              onClick={() => signOutUser().then(() => navigate('/'))}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[380px] mx-auto py-12 apple-fade">
      {/* Brand Icon Header matching reference */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/[0.04] text-zinc-300 mb-4 border border-white/[0.06]">
          <span className="text-2xl leading-none select-none text-zinc-300">✱</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white font-display">
          {mode === 'signin' ? 'WELCOME BACK' : 'CREATE ACCOUNT'}
        </h1>
        <p className="text-xs text-zinc-400 mt-1">
          {mode === 'signin' ? 'Sign in to access your cloud swarms and chats' : 'Start autonomous swarms backed by AWS Bedrock'}
        </p>
      </div>

      <div className="clean-card p-6 shadow-xl">
        {error && (
          <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Biometric Passkey Fast Auth */}
        <div>
          <button
            type="button"
            onClick={handlePasskeySignIn}
            disabled={loading}
            className="apple-btn w-full flex items-center justify-center gap-3 py-2.5 px-3 rounded bg-zinc-900 border border-white/[0.12] text-white text-xs font-medium hover:bg-zinc-800 transition-colors"
          >
            <Fingerprint className="h-4 w-4 text-emerald-400" />
            <span>Continue with Passkey (Face ID / Touch ID)</span>
          </button>
        </div>

        {/* Divider */}
        <div className="relative my-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/[0.08]" />
          </div>
          <div className="relative flex justify-center text-[11px] uppercase">
            <span className="bg-[#111114] px-2 text-zinc-500">or</span>
          </div>
        </div>

        {/* Email & Password Form */}
        <form onSubmit={handleEmailAuth} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
                className="w-full px-3 py-2 rounded bg-zinc-900 border border-white/[0.1] text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/[0.3] transition-colors"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="samlee.mobbin@gmail.com"
              className="w-full px-3 py-2 rounded bg-zinc-900 border border-white/[0.1] text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/[0.3] transition-colors"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-zinc-300">Password</label>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              minLength={6}
              className="w-full px-3 py-2 rounded bg-zinc-900 border border-white/[0.1] text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-white/[0.3] transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-2 px-4 rounded bg-white text-black font-semibold text-xs hover:bg-zinc-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="inline-block animate-spin h-3.5 w-3.5 border-2 border-black border-t-transparent rounded-full" />
            ) : (
              <span>Continue</span>
            )}
          </button>
        </form>

        {/* Footer toggles */}
        <div className="mt-5 pt-4 border-t border-white/[0.08] text-center space-y-2 text-xs">
          <div>
            {mode === 'signin' ? (
              <span className="text-zinc-500">
                Don't have an account yet?{' '}
                <button
                  type="button"
                  onClick={() => { setMode('signup'); setError(null); }}
                  className="text-white hover:underline font-medium"
                >
                  Sign up
                </button>
              </span>
            ) : (
              <span className="text-zinc-500">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => { setMode('signin'); setError(null); }}
                  className="text-white hover:underline font-medium"
                >
                  Sign in
                </button>
              </span>
            )}
          </div>

          {mode === 'signin' && (
            <div>
              <span className="text-zinc-500">
                Forgot password?{' '}
                <button
                  type="button"
                  onClick={() => setError('Password reset instructions will be sent via AWS SES.')}
                  className="text-zinc-400 hover:text-white hover:underline"
                >
                  Reset
                </button>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Floating help indicator matching reference */}
      <div className="mt-6 flex justify-end">
        <a
          href="/docs"
          title="Lyra Authentication Documentation"
          className="w-7 h-7 rounded-full bg-zinc-900 border border-white/[0.1] flex items-center justify-center text-xs text-zinc-400 hover:text-white hover:border-white/[0.2] transition-colors"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
};

export default Auth;
