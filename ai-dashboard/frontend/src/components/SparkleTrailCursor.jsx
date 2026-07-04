import { useEffect, useRef } from "react";
import "./SparkleTrailCursor.css";

/**
 * SparkleTrailCursor
 * Small glowing particles scatter from the cursor and drift outward,
 * fading independently — a comet-like sparkle trail rather than a
 * single blob or continuous line.
 */
export default function SparkleTrailCursor() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const resize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", resize);

    const particles = [];
    const mouse = { x: width / 2, y: height / 2, px: width / 2, py: height / 2 };

    const onMove = (e) => {
      mouse.px = mouse.x;
      mouse.py = mouse.y;
      mouse.x = e.clientX;
      mouse.y = e.clientY;

      const speed = Math.hypot(mouse.x - mouse.px, mouse.y - mouse.py);
      const count = Math.min(4, 1 + Math.floor(speed / 8));

      for (let i = 0; i < count; i++) {
        particles.push(new Sparkle(mouse.x, mouse.y));
      }
    };
    window.addEventListener("mousemove", onMove);

    class Sparkle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.5 + Math.random() * 2.2;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed - 0.3; // slight upward bias
        this.radius = 0.8 + Math.random() * 2;
        this.life = 1;
        this.decay = 0.03 + Math.random() * 0.03;
        // green-white sparkle, matching the aurora reference
        this.hue = 140 + Math.random() * 20;
        this.light = 60 + Math.random() * 30;
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.97;
        this.vy *= 0.97;
        this.life -= this.decay;
      }

      draw(ctx) {
        if (this.life <= 0) return;
        const alpha = Math.max(this.life, 0);

        // Draw glow layer (larger, transparent)
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${this.hue}, 90%, 60%, ${alpha * 0.25})`;
        ctx.fill();

        // Draw core layer (smaller, bright)
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${this.hue}, 90%, ${this.light}%, ${alpha})`;
        ctx.fill();
      }
    }

    let frame;
    const loop = () => {
      // Use destination-out so this actually erases alpha each frame,
      // instead of painting a new semi-transparent layer on top (which
      // was slowly making the canvas opaque and left permanent ghost
      // smudges once composited with the page via mix-blend-mode: screen).
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = "lighter";
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.update();
        p.draw(ctx);
        if (p.life <= 0) particles.splice(i, 1);
      }
      ctx.globalCompositeOperation = "source-over";

      if (particles.length > 500) particles.splice(0, particles.length - 500);

      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return <canvas ref={canvasRef} className="sparkle-trail-canvas" />;
}