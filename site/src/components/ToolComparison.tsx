import React from 'react';
import { Check, X } from 'lucide-react';

interface FeatureComparison {
  feature: string;
  powerTool: boolean;
  cncMachine: boolean;
  description: string;
}

const ToolComparison: React.FC = () => {
  const comparisonData: FeatureComparison[] = [
    {
      feature: "Autonomous Execution",
      powerTool: false,
      cncMachine: true,
      description: "Executes tasks without continuous human intervention"
    },
    {
      feature: "Intelligent Decision Making",
      powerTool: false,
      cncMachine: true,
      description: "Makes context-aware decisions during operation"
    },
    {
      feature: "Self-Optimization",
      powerTool: false,
      cncMachine: true,
      description: "Continuously improves performance based on feedback"
    },
    {
      feature: "Multi-Agent Collaboration",
      powerTool: false,
      cncMachine: true,
      description: "Multiple agents work together on complex tasks"
    },
    {
      feature: "Real-time Adaptation",
      powerTool: false,
      cncMachine: true,
      description: "Adapts to changing requirements instantly"
    },
    {
      feature: "Manual Control",
      powerTool: true,
      cncMachine: false,
      description: "Direct human operation and control"
    },
    {
      feature: "Predefined Operations",
      powerTool: true,
      cncMachine: false,
      description: "Limited to specific programmed functions"
    },
    {
      feature: "Single-threaded Processing",
      powerTool: true,
      cncMachine: false,
      description: "One task at a time execution"
    }
  ];

  return (
    <div className="space-y-8 py-8">
      <div className="text-center">
        <h2 className="text-3xl font-bold mb-4">Power Tool vs CNC Machine</h2>
        <p className="text-gray-400 max-w-2xl mx-auto">
          Understanding the fundamental paradigm shift from traditional development tools to Lyra's autonomous approach
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="bg-gradient-to-br from-blue-900/30 to-blue-700/20 border border-blue-800/50 rounded-2xl p-6 transition-all hover:border-blue-600/50">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">🔧</span>
            </div>
            <h3 className="text-2xl font-bold">Power Tool</h3>
            <p className="text-blue-300 mt-2">Traditional Development Approach</p>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="mt-1 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                <Check className="h-3 w-3" />
              </div>
              <div>
                <h4 className="font-medium">Human-Centric</h4>
                <p className="text-sm text-blue-200/80">Requires direct human operation and decision-making</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="mt-1 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                <Check className="h-3 w-3" />
              </div>
              <div>
                <h4 className="font-medium">Immediate Control</h4>
                <p className="text-sm text-blue-200/80">Full manual control over every operation</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="mt-1 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                <Check className="h-3 w-3" />
              </div>
              <div>
                <h4 className="font-medium">Predictable Output</h4>
                <p className="text-sm text-blue-200/80">Results directly correlate to human input</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-900/30 to-purple-700/20 border border-purple-800/50 rounded-2xl p-6 transition-all hover:border-purple-600/50">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">🤖</span>
            </div>
            <h3 className="text-2xl font-bold">CNC Machine</h3>
            <p className="text-purple-300 mt-2">Lyra's Autonomous Approach</p>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="mt-1 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0">
                <Check className="h-3 w-3" />
              </div>
              <div>
                <h4 className="font-medium">Autonomous Operation</h4>
                <p className="text-sm text-purple-200/80">Operates independently with high-level guidance</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="mt-1 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0">
                <Check className="h-3 w-3" />
              </div>
              <div>
                <h4 className="font-medium">Intelligent Planning</h4>
                <p className="text-sm text-purple-200/80">Creates and executes complex plans automatically</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="mt-1 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center flex-shrink-0">
                <Check className="h-3 w-3" />
              </div>
              <div>
                <h4 className="font-medium">Adaptive Execution</h4>
                <p className="text-sm text-purple-200/80">Adjusts approach based on real-time feedback</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gray-800/30 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-800/50">
            <tr>
              <th className="text-left p-4 font-medium">Feature</th>
              <th className="text-center p-4 font-medium">Power Tool</th>
              <th className="text-center p-4 font-medium">CNC Machine</th>
            </tr>
          </thead>
          <tbody>
            {comparisonData.map((item, index) => (
              <tr 
                key={index} 
                className="border-t border-gray-800 hover:bg-gray-800/20 transition-colors"
              >
                <td className="p-4">
                  <div className="font-medium">{item.feature}</div>
                  <div className="text-sm text-gray-400 mt-1">{item.description}</div>
                </td>
                <td className="p-4 text-center">
                  {item.powerTool ? (
                    <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-500/20 text-green-400 mx-auto">
                      <Check className="h-4 w-4" />
                    </div>
                  ) : (
                    <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-500/20 text-red-400 mx-auto">
                      <X className="h-4 w-4" />
                    </div>
                  )}
                </td>
                <td className="p-4 text-center">
                  {item.cncMachine ? (
                    <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-500/20 text-green-400 mx-auto">
                      <Check className="h-4 w-4" />
                    </div>
                  ) : (
                    <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-500/20 text-red-400 mx-auto">
                      <X className="h-4 w-4" />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-gradient-to-r from-indigo-900/30 to-purple-900/30 border border-indigo-500/20 rounded-2xl p-6">
        <h3 className="text-xl font-bold mb-3">Why This Matters</h3>
        <p className="text-gray-300 mb-4">
          The shift from Power Tools to CNC Machines represents a fundamental change in how we approach software development. 
          Instead of manually executing each step, developers become planners and supervisors, delegating the detailed execution 
          to intelligent systems that can work faster, more consistently, and with fewer errors than humans.
        </p>
        <p className="text-gray-300">
          Lyra embodies this CNC approach, allowing developers to focus on high-level architecture and creative problem-solving 
          while autonomous agents handle the implementation details, testing, and optimization.
        </p>
      </div>
    </div>
  );
};

export default ToolComparison;