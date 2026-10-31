import React from 'react';
import ToolComparison from '../components/ToolComparison';

const Comparison: React.FC = () => {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-4">Power Tool vs CNC Machine</h1>
        <p className="text-gray-400 max-w-2xl mx-auto">
          Understanding the fundamental paradigm shift from traditional development tools to Lyra's autonomous approach
        </p>
      </div>
      <ToolComparison />
    </div>
  );
};

export default Comparison;