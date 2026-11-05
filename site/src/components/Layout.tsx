import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ArrowUpRight, User } from 'lucide-react';
import { useSession } from '../lib/auth-client';

const Layout: React.FC = () => {
  const location = useLocation();
  const { data: session } = useSession();
  const user = session?.user;

  const navLinks = [
    { path: '/', label: 'Overview' },
    { path: '/architecture', label: 'Architecture' },
    { path: '/docs', label: 'Docs' },
  ];

  return (
    <div className="min-h-screen bg-[#09090b] text-[#ededed] flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-white/[0.08] bg-[#09090b]/75 backdrop-blur-xl sticky top-0 z-40 transition-colors">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2 group">
              <span className="text-zinc-400 group-hover:text-white transition-colors text-base leading-none select-none">✱</span>
              <span className="font-brand text-sm tracking-widest text-white group-hover:text-zinc-200 transition-colors">
                LYRA
              </span>
            </Link>

            <nav className="hidden sm:flex items-center gap-6 text-xs text-zinc-400">
              {navLinks.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`transition-colors duration-200 ${isActive ? 'text-white font-medium' : 'hover:text-zinc-200'}`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-4 text-xs">
            {user ? (
              <Link
                to="/account"
                className="apple-btn flex items-center gap-2 px-2.5 py-1 rounded bg-zinc-900 border border-white/[0.1] text-xs text-zinc-200 hover:text-white hover:border-white/[0.2] transition-colors"
              >
                <div className="w-4 h-4 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] text-white">
                  {((user.name || user.email || 'U')[0] ?? 'U').toUpperCase()}
                </div>
                <span>{user.name || user.email?.split('@')[0]}</span>
              </Link>
            ) : (
              <Link
                to="/login"
                className="text-zinc-400 hover:text-white transition-colors flex items-center gap-1.5"
              >
                <User className="h-3.5 w-3.5" />
                <span>Sign In</span>
              </Link>
            )}

            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="text-zinc-400 hover:text-white transition-colors hidden sm:flex items-center gap-1"
            >
              <span>GitHub</span>
              <ArrowUpRight className="h-3 w-3" />
            </a>

            <a
              href="/extensions/vscode/lyra-swarm-1.3.0.vsix"
              download
              className="apple-btn px-3 py-1.5 rounded bg-white text-black font-medium text-xs hover:bg-zinc-200 transition-colors"
            >
              Install Extension
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-5xl mx-auto px-6 w-full py-12 sm:py-16">
        <Outlet />
      </main>

      {/* Clean Footer */}
      <footer className="border-t border-white/[0.08] py-8 text-xs text-zinc-500">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-brand text-xs tracking-wider text-zinc-400">LYRA</span>
            <span>· Cloud Engineering v1.3.0</span>
          </div>
          <div className="flex items-center gap-6">
            <Link to="/login" className="hover:text-zinc-300 transition-colors">
              Account &amp; Sync
            </Link>
            <Link to="/docs" className="hover:text-zinc-300 transition-colors">
              Documentation
            </Link>
            <a href="/extensions/vscode/lyra-swarm-1.3.0.vsix" className="hover:text-zinc-300 transition-colors">
              VSIX Download
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
