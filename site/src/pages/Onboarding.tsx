import React, { useState } from 'react';
import { CheckCircle, Download, Code, Terminal, User, Key, ArrowRight, ExternalLink } from 'lucide-react';

const Onboarding: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(1);
  
  const steps = [
    {
      id: 1,
      title: "Install VS Code or Coder",
      description: "Set up your preferred development environment",
      completed: false
    },
    {
      id: 2,
      title: "Install Lyra Extension",
      description: "Add the Lyra extension to your editor",
      completed: false
    },
    {
      id: 3,
      title: "Authenticate with GitHub",
      description: "Connect your GitHub account for repository access",
      completed: false
    },
    {
      id: 4,
      title: "Generate Personal Access Token",
      description: "Create a secure token for API authentication",
      completed: false
    },
    {
      id: 5,
      title: "Configure Lyra Settings",
      description: "Set up your preferences and cloud integrations",
      completed: false
    }
  ];

  const environments = [
    {
      id: 'vscode',
      name: 'VS Code',
      description: 'Local development environment',
      icon: ' vscode',
      steps: [
        "Download VS Code from the official website",
        "Install the application following platform-specific instructions",
        "Launch VS Code to complete initial setup"
      ]
    },
    {
      id: 'coder',
      name: 'Coder',
      description: 'Cloud-based development environment',
      icon: ' coder',
      steps: [
        "Sign up for a Coder account at coder.com",
        "Create a new workspace template",
        "Configure your development environment settings"
      ]
    }
  ];

  const [selectedEnv, setSelectedEnv] = useState('vscode');

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-4">VS Code/Coder Onboarding</h1>
        <p className="text-gray-400 max-w-2xl mx-auto">
          Get started with Lyra in your preferred development environment
        </p>
      </div>

      {/* Progress Tracker */}
      <div className="bg-gray-800/30 border border-gray-700 rounded-2xl p-6">
        <div className="flex justify-between relative mb-8">
          <div className="absolute top-4 left-0 right-0 h-0.5 bg-gray-700 -z-10"></div>
          {steps.map((step) => (
            <div key={step.id} className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-2 ${
                currentStep >= step.id 
                  ? 'bg-indigo-500 text-white' 
                  : 'bg-gray-700 text-gray-400'
              }`}>
                {currentStep > step.id ? (
                  <CheckCircle className="h-5 w-5" />
                ) : (
                  step.id
                )}
              </div>
              <span className="text-xs text-center max-w-[100px]">
                {step.title}
              </span>
            </div>
          ))}
        </div>

        <div className="text-center">
          <h3 className="font-semibold text-lg mb-2">
            {steps.find(s => s.id === currentStep)?.title}
          </h3>
          <p className="text-gray-400 mb-6">
            {steps.find(s => s.id === currentStep)?.description}
          </p>
        </div>
      </div>

      {/* Environment Selection */}
      <div className="bg-gray-800/30 border border-gray-700 rounded-2xl p-6">
        <h2 className="text-xl font-semibold mb-4">Choose Your Development Environment</h2>
        
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {environments.map((env) => (
            <div 
              key={env.id}
              onClick={() => setSelectedEnv(env.id)}
              className={`border rounded-xl p-5 cursor-pointer transition-all ${
                selectedEnv === env.id
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-gray-700 hover:border-gray-600'
              }`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-gray-700 rounded-lg flex items-center justify-center">
                  {env.id === 'vscode' ? (
                    <Code className="h-5 w-5" />
                  ) : (
                    <Terminal className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h3 className="font-medium">{env.name}</h3>
                  <p className="text-sm text-gray-400">{env.description}</p>
                </div>
              </div>
              
              <div className="space-y-2">
                {env.steps.map((step, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm">
                    <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full mt-2 flex-shrink-0"></div>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Step-by-step Instructions */}
        {selectedEnv === 'vscode' ? (
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0 mt-1">
                <Download className="h-4 w-4 text-indigo-400" />
              </div>
              <div>
                <h3 className="font-medium mb-2">1. Install VS Code</h3>
                <p className="text-gray-400 mb-3">
                  Download and install Visual Studio Code from the official website.
                </p>
                <a 
                  href="https://code.visualstudio.com/" 
                  target="_blank"
                  className="inline-flex items-center gap-2 text-indigo-400 hover:underline"
                >
                  Download VS Code <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0 mt-1">
                <Code className="h-4 w-4 text-indigo-400" />
              </div>
              <div>
                <h3 className="font-medium mb-2">2. Install Lyra Extension</h3>
                <p className="text-gray-400 mb-3">
                  Open VS Code and navigate to the Extensions marketplace. Search for "Lyra" and install the official extension.
                </p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-400">
                  <li>Open VS Code</li>
                  <li>Click on the Extensions icon in the sidebar</li>
                  <li>Search for "Lyra"</li>
                  <li>Click "Install" on the Lyra extension</li>
                </ol>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0 mt-1">
                <User className="h-4 w-4 text-indigo-400" />
              </div>
              <div>
                <h3 className="font-medium mb-2">3. Authenticate with GitHub</h3>
                <p className="text-gray-400 mb-3">
                  After installing the extension, open the Lyra panel and sign in with your GitHub account.
                </p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-400">
                  <li>Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)</li>
                  <li>Type "Lyra: Sign In" and press Enter</li>
                  <li>Follow the prompts to authenticate with GitHub</li>
                </ol>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0 mt-1">
                <Key className="h-4 w-4 text-indigo-400" />
              </div>
              <div>
                <h3 className="font-medium mb-2">4. Generate Personal Access Token</h3>
                <p className="text-gray-400 mb-3">
                  Create a secure token for API authentication through the developer portal.
                </p>
                <a 
                  href="/pat-generator" 
                  className="inline-flex items-center gap-2 text-indigo-400 hover:underline"
                >
                  Go to PAT Generator <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0 mt-1">
                <Terminal className="h-4 w-4 text-indigo-400" />
              </div>
              <div>
                <h3 className="font-medium mb-2">1. Set Up Coder Workspace</h3>
                <p className="text-gray-400 mb-3">
                  Sign up for Coder and create a new workspace with the Lyra development template.
                </p>
                <a 
                  href="https://coder.com/" 
                  target="_blank"
                  className="inline-flex items-center gap-2 text-indigo-400 hover:underline"
                >
                  Visit Coder.com <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0 mt-1">
                <Code className="h-4 w-4 text-indigo-400" />
              </div>
              <div>
                <h3 className="font-medium mb-2">2. Install Lyra Extension</h3>
                <p className="text-gray-400 mb-3">
                  Within your Coder workspace, install the Lyra extension from the marketplace.
                </p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-400">
                  <li>Open the Extensions panel in your Coder workspace</li>
                  <li>Search for "Lyra"</li>
                  <li>Click "Install" on the Lyra extension</li>
                </ol>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0 mt-1">
                <User className="h-4 w-4 text-indigo-400" />
              </div>
              <div>
                <h3 className="font-medium mb-2">3. Authenticate with GitHub</h3>
                <p className="text-gray-400 mb-3">
                  Connect your GitHub account to enable repository access and collaboration features.
                </p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-400">
                  <li>Open the Command Palette</li>
                  <li>Type "Lyra: Sign In" and press Enter</li>
                  <li>Follow the authentication flow</li>
                </ol>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0 mt-1">
                <Key className="h-4 w-4 text-indigo-400" />
              </div>
              <div>
                <h3 className="font-medium mb-2">4. Generate Personal Access Token</h3>
                <p className="text-gray-400 mb-3">
                  Create a secure token for API authentication through the developer portal.
                </p>
                <a 
                  href="/pat-generator" 
                  className="inline-flex items-center gap-2 text-indigo-400 hover:underline"
                >
                  Go to PAT Generator <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-gray-800 flex justify-between">
          <button
            onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
            disabled={currentStep === 1}
            className="px-4 py-2 rounded-lg border border-gray-700 hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <button
            onClick={() => setCurrentStep(Math.min(steps.length, currentStep + 1))}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 flex items-center gap-2"
          >
            Next Step <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Help Resources */}
      <div className="bg-gray-800/30 border border-gray-700 rounded-2xl p-6">
        <h2 className="text-xl font-semibold mb-4">Need Help?</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <a 
            href="#" 
            className="border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
          >
            <h3 className="font-medium mb-1">Documentation</h3>
            <p className="text-sm text-gray-400">Comprehensive guides and tutorials</p>
          </a>
          <a 
            href="#" 
            className="border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
          >
            <h3 className="font-medium mb-1">Community Forum</h3>
            <p className="text-sm text-gray-400">Get help from other developers</p>
          </a>
          <a 
            href="#" 
            className="border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
          >
            <h3 className="font-medium mb-1">Support</h3>
            <p className="text-sm text-gray-400">Contact our support team</p>
          </a>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;