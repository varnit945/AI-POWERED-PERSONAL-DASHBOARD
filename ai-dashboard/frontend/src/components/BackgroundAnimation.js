import React, { useEffect, useRef } from 'react';
import './BackgroundAnimation.css';

// Simple 3D starfield animation using canvas 2D with depth simulation
export default function BackgroundAnimation() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);
    const stars = [];
    const numStars = 250;
    const speed = 0.05;
    // Initialize stars
    for (let i = 0; i < numStars; i++) {
      stars.push({
        x: (Math.random() - 0.5) * width,
        y: (Math.random() - 0.5) * height,
        z: Math.random() * width,
        o: Math.random() * 0.5 + 0.5,
      });
    }
    const render = () => {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#fff';
      for (let i = 0; i < numStars; i++) {
        const s = stars[i];
        s.z -= speed * width;
        if (s.z <= 0) {
          s.z = width;
          s.x = (Math.random() - 0.5) * width;
          s.y = (Math.random() - 0.5) * height;
        }
        const k = 128.0 / s.z;
        const px = s.x * k + width / 2;
        const py = s.y * k + height / 2;
        const size = (1 - s.z / width) * 2;
        ctx.globalAlpha = s.o * (1 - s.z / width);
        ctx.fillRect(px, py, size, size);
      }
      ctx.globalAlpha = 1;
    };
    let animationId;
    const loop = () => {
      render();
      animationId = requestAnimationFrame(loop);
    };
    loop();
    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="bg-canvas" />;
}
