import React from 'react';
import { Link, Outlet } from 'react-router-dom';
import { Activity } from 'lucide-react';

const Layout: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <Link to="/" className="flex items-center gap-2 text-xl font-bold">
            <Activity className="h-6 w-6 text-indigo-500" />
            <span>Lyra</span>
          </Link>
          
          <nav className="hidden md:flex gap-6">
            <Link to="/" className="hover:text-indigo-400 transition-colors">Home</Link>
            <Link to="/simulator" className="hover:text-indigo-400 transition-colors">Swarm Simulator</Link>
            <Link to="/comparison" className="hover:text-indigo-400 transition-colors">Comparison</Link>
            <Link to="/pat-generator" className="hover:text-indigo-400 transition-colors">PAT Generator</Link>
            <Link to="/onboarding" className="hover:text-indigo-400 transition-colors">Onboarding</Link>
          </nav>
          
          <div className="flex items-center gap-4">
            <button className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              Get Started
            </button>
          </div>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-8">
        <Outlet />
      </main>
      
      <footer className="border-t border-gray-800 py-8 mt-12">
        <div className="container mx-auto px-4 text-center text-gray-400 text-sm">
          <p>© {new Date().getFullYear()} Lyra Developer Portal. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default Layout;