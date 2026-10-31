import React from 'react';
import { Link } from 'react-router-dom';
import { Activity, FileText, Key, Wand, ArrowRight } from 'lucide-react';

const Home: React.FC = () => {
  const features = [
    {
      icon: <Activity className="h-8 w-8 text-indigo-500" />,
      title: "Interactive Swarm Simulator",
      description: "Visualize and interact with Lyra's autonomous agent swarms in real-time.",
      link: "/simulator"
    },
    {
      icon: <FileText className="h-8 w-8 text-indigo-500" />,
      title: "Power Tool vs CNC Machine",
      description: "Understand the fundamental differences between traditional tools and Lyra's autonomous approach.",
      link: "/comparison"
    },
    {
      icon: <Key className="h-8 w-8 text-indigo-500" />,
      title: "PAT Generator",
      description: "Generate Personal Access Tokens for secure API authentication.",
      link: "/pat-generator"
    },
    {
      icon: <Wand className="h-8 w-8 text-indigo-500" />,
      title: "VS Code/Coder Onboarding",
      description: "Step-by-step guide to set up your development environment with Lyra.",
      link: "/onboarding"
    }
  ];

  return (
    <div className="space-y-16">
      {/* Hero Section */}
      <section className="text-center py-16 md:py-24">
        <h1 className="text-4xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-indigo-400 to-purple-500 bg-clip-text text-transparent">
          Lyra Developer Portal
        </h1>
        <p className="text-xl text-gray-300 max-w-2xl mx-auto mb-10">
          Experience the future of autonomous software development with Lyra's intelligent swarm of agents.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link 
            to="/simulator" 
            className="bg-indigo-600 hover:bg-indigo-700 px-6 py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
          >
            Try the Simulator <ArrowRight className="h-4 w-4" />
          </Link>
          <Link 
            to="/onboarding" 
            className="border border-gray-700 hover:border-gray-600 px-6 py-3 rounded-lg font-medium transition-colors"
          >
            Get Started
          </Link>
        </div>
      </section>

      {/* Features Grid */}
      <section className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
        {features.map((feature, index) => (
          <Link 
            key={index} 
            to={feature.link}
            className="bg-gray-800/50 hover:bg-gray-800 border border-gray-800 rounded-xl p-6 transition-all hover:border-indigo-500/30 group"
          >
            <div className="mb-4">
              {feature.icon}
            </div>
            <h3 className="text-xl font-semibold mb-2 group-hover:text-indigo-400 transition-colors">
              {feature.title}
            </h3>
            <p className="text-gray-400 mb-4">
              {feature.description}
            </p>
            <span className="text-indigo-400 text-sm font-medium flex items-center gap-1">
              Explore <ArrowRight className="h-3 w-3" />
            </span>
          </Link>
        ))}
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-r from-indigo-900/30 to-purple-900/30 border border-indigo-500/20 rounded-2xl p-8 md:p-12 text-center">
        <h2 className="text-2xl md:text-3xl font-bold mb-4">Ready to Transform Your Development Workflow?</h2>
        <p className="text-gray-300 max-w-2xl mx-auto mb-8">
          Join thousands of developers who are already leveraging Lyra's autonomous agents to build better software faster.
        </p>
        <Link 
          to="/onboarding" 
          className="bg-white text-gray-900 hover:bg-gray-100 px-6 py-3 rounded-lg font-medium inline-flex items-center gap-2 transition-colors"
        >
          Start Building <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </div>
  );
};

export default Home;