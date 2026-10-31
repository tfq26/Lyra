import React, { useRef, useEffect, useState } from 'react';
import { Play, Pause, RotateCcw, Settings } from 'lucide-react';

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
}

const Simulator: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [particleCount, setParticleCount] = useState(150);
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number>(0);
  const [showSettings, setShowSettings] = useState(false);

  // Initialize particles
  const initParticles = () => {
    const particles: Particle[] = [];
    const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b'];
    
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        id: i,
        x: Math.random() * (canvasRef.current?.width || 800),
        y: Math.random() * (canvasRef.current?.height || 600),
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        radius: Math.random() * 3 + 2,
        color: colors[Math.floor(Math.random() * colors.length)] ?? '#6366f1'
      });
    }
    
    particlesRef.current = particles;
  };

  // Animation loop
  const animate = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas
    ctx.fillStyle = '#090a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Update and draw particles
    particlesRef.current.forEach(particle => {
      // Update position
      particle.x += particle.vx;
      particle.y += particle.vy;
      
      // Boundary collision
      if (particle.x <= particle.radius || particle.x >= canvas.width - particle.radius) {
        particle.vx *= -1;
      }
      if (particle.y <= particle.radius || particle.y >= canvas.height - particle.radius) {
        particle.vy *= -1;
      }
      
      // Draw particle
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      ctx.fillStyle = particle.color;
      ctx.fill();
      
      // Draw glow effect
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 15;
      ctx.fill();
      ctx.shadowBlur = 0;
    });
    
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(animate);
    }
  };

  // Handle canvas resize
  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    initParticles();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    if (isPlaying) {
      animationRef.current = requestAnimationFrame(animate);
    }
    
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying]);

  useEffect(() => {
    initParticles();
  }, [particleCount]);

  const togglePlayPause = () => {
    setIsPlaying(!isPlaying);
    if (!isPlaying) {
      animationRef.current = requestAnimationFrame(animate);
    }
  };

  const resetSimulation = () => {
    initParticles();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Canvas 2.0 Swarm Simulator</h1>
          <p className="text-gray-400 mt-2">
            Visualize Lyra's autonomous agent swarms in real-time
          </p>
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={togglePlayPause}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition-colors"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          
          <button
            onClick={resetSimulation}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
          
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition-colors"
          >
            <Settings className="h-4 w-4" />
            Settings
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
          <h3 className="font-medium mb-3">Simulation Settings</h3>
          <div className="flex items-center gap-4">
            <label className="text-sm">
              Particles: {particleCount}
            </label>
            <input
              type="range"
              min="50"
              max="500"
              value={particleCount}
              onChange={(e) => setParticleCount(parseInt(e.target.value))}
              className="w-32"
            />
          </div>
        </div>
      )}

      <div className="bg-gray-800/30 border border-gray-800 rounded-xl overflow-hidden">
        <canvas 
          ref={canvasRef} 
          className="w-full h-[600px] bg-gray-900"
        />
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="bg-gray-800/30 border border-gray-800 rounded-lg p-6">
          <h3 className="font-semibold mb-2">Swarm Intelligence</h3>
          <p className="text-gray-400 text-sm">
            Each particle represents an autonomous agent working collaboratively to achieve complex objectives.
          </p>
        </div>
        
        <div className="bg-gray-800/30 border border-gray-800 rounded-lg p-6">
          <h3 className="font-semibold mb-2">Real-time Coordination</h3>
          <p className="text-gray-400 text-sm">
            Agents communicate and coordinate dynamically, adapting to changing conditions and requirements.
          </p>
        </div>
        
        <div className="bg-gray-800/30 border border-gray-800 rounded-lg p-6">
          <h3 className="font-semibold mb-2">Scalable Architecture</h3>
          <p className="text-gray-400 text-sm">
            The swarm scales automatically based on task complexity, ensuring optimal resource utilization.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Simulator;