import React, { useState } from 'react';
import { Copy, Check, Eye, EyeOff, Key } from 'lucide-react';

const PatGenerator: React.FC = () => {
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [permissions, setPermissions] = useState({
    read: true,
    write: true,
    admin: false,
    swarmControl: true
  });
  const [expiration, setExpiration] = useState('30d');

  const generateToken = () => {
    // In a real implementation, this would call an API
    // For demo purposes, we'll generate a fake token
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 40; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setToken(`lyra_pat_${result}`);
    setCopied(false);
  };

  const copyToClipboard = () => {
    if (token) {
      navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-4">Personal Access Token Generator</h1>
        <p className="text-gray-400">
          Generate secure tokens for authenticating with the Lyra API
        </p>
      </div>

      <div className="bg-gray-800/30 border border-gray-700 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-indigo-500/20 rounded-lg flex items-center justify-center">
            <Key className="h-5 w-5 text-indigo-400" />
          </div>
          <div>
            <h2 className="font-semibold">Create New Token</h2>
            <p className="text-sm text-gray-400">Configure permissions and expiration</p>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Token Permissions</label>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700 hover:border-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={permissions.read}
                  disabled
                  className="rounded text-indigo-500 focus:ring-indigo-500"
                />
                <div>
                  <div className="font-medium">Read Access</div>
                  <div className="text-xs text-gray-400">View projects and data</div>
                </div>
              </label>
              
              <label className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700 hover:border-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={permissions.write}
                  onChange={(e) => setPermissions({...permissions, write: e.target.checked})}
                  className="rounded text-indigo-500 focus:ring-indigo-500"
                />
                <div>
                  <div className="font-medium">Write Access</div>
                  <div className="text-xs text-gray-400">Modify projects and data</div>
                </div>
              </label>
              
              <label className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700 hover:border-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={permissions.admin}
                  onChange={(e) => setPermissions({...permissions, admin: e.target.checked})}
                  className="rounded text-indigo-500 focus:ring-indigo-500"
                />
                <div>
                  <div className="font-medium">Admin Access</div>
                  <div className="text-xs text-gray-400">Manage settings and users</div>
                </div>
              </label>
              
              <label className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700 hover:border-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={permissions.swarmControl}
                  onChange={(e) => setPermissions({...permissions, swarmControl: e.target.checked})}
                  className="rounded text-indigo-500 focus:ring-indigo-500"
                />
                <div>
                  <div className="font-medium">Swarm Control</div>
                  <div className="text-xs text-gray-400">Control autonomous agents</div>
                </div>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Expiration</label>
            <div className="flex flex-wrap gap-3">
              {['7d', '30d', '90d', '1y'].map((option) => (
                <label 
                  key={option}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer ${
                    expiration === option 
                      ? 'border-indigo-500 bg-indigo-500/10' 
                      : 'border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="expiration"
                    value={option}
                    checked={expiration === option}
                    onChange={(e) => setExpiration(e.target.value)}
                    className="text-indigo-500 focus:ring-indigo-500"
                  />
                  <span>{option === '1y' ? '1 Year' : option === '7d' ? '7 Days' : option === '30d' ? '30 Days' : '90 Days'}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={generateToken}
            className="w-full bg-indigo-600 hover:bg-indigo-700 py-3 rounded-lg font-medium transition-colors"
          >
            Generate Token
          </button>
        </div>
      </div>

      {token && (
        <div className="bg-gray-800/30 border border-gray-700 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
              <Check className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <h2 className="font-semibold">Your Personal Access Token</h2>
              <p className="text-sm text-gray-400">Copy this token now - you won't see it again!</p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1 relative">
              <input
                type={showToken ? "text" : "password"}
                value={token}
                readOnly
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 pr-12 font-mono text-sm"
              />
              <button
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 px-4 py-3 rounded-lg transition-colors whitespace-nowrap"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" /> Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" /> Copy
                </>
              )}
            </button>
          </div>

          <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <h3 className="font-medium text-yellow-500 flex items-center gap-2">
              <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
              Security Notice
            </h3>
            <p className="text-sm text-yellow-200/90 mt-2">
              Treat this token like a password. Store it securely and never share it in public repositories or communications.
            </p>
          </div>
        </div>
      )}

      <div className="bg-gray-800/30 border border-gray-700 rounded-2xl p-6">
        <h3 className="font-semibold mb-3">Using Your Token</h3>
        <p className="text-gray-400 mb-4">
          Include your token in the Authorization header when making API requests:
        </p>
        <pre className="bg-gray-900 rounded-lg p-4 text-sm overflow-x-auto">
          {`curl -H "Authorization: Bearer ${token || 'YOUR_TOKEN_HERE'}" \\
  https://api.lyra.dev/v1/projects`}
        </pre>
        <p className="text-gray-400 mt-4 text-sm">
          For more information on API usage, visit our <a href="#" className="text-indigo-400 hover:underline">API documentation</a>.
        </p>
      </div>
    </div>
  );
};

export default PatGenerator;