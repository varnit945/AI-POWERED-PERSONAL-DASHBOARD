import React, { useEffect, useRef } from "react";

export default function StarfieldBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const numStars = 160;
    const stars = [];

    // Initialize stars with x, y, z coordinates
    for (let i = 0; i < numStars; i++) {
      stars.push({
        x: (Math.random() - 0.5) * width,
        y: (Math.random() - 0.5) * height,
        z: Math.random() * width,
        prevZ: 0,
        color: getRandomColor()
      });
      stars[i].prevZ = stars[i].z;
    }

    function getRandomColor() {
      const rand = Math.random();
      if (rand < 0.2) return "rgba(242, 169, 59, 0.65)"; // Accent orange
      if (rand < 0.4) return "rgba(61, 217, 176, 0.65)"; // Accent green
      if (rand < 0.6) return "rgba(59, 130, 246, 0.65)"; // Blue glow
      return "rgba(255, 255, 255, 0.75)"; // Pure white star
    }

    const speed = 2.8;

    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    }
    window.addEventListener("resize", resize);

    function animate() {
      // Trail effect: clear with high transparency dark color matching the theme
      ctx.fillStyle = "rgba(16, 21, 28, 0.18)";
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < numStars; i++) {
        const star = stars[i];
        star.prevZ = star.z;
        star.z -= speed;

        if (star.z <= 0) {
          star.z = width;
          star.x = (Math.random() - 0.5) * width;
          star.y = (Math.random() - 0.5) * height;
          star.prevZ = star.z;
        }

        // 3D perspective projection
        const k = 120 / star.z;
        const px = star.x * k + width / 2;
        const py = star.y * k + height / 2;

        const pk = 120 / star.prevZ;
        const ppx = star.x * pk + width / 2;
        const ppy = star.y * pk + height / 2;

        if (px >= 0 && px <= width && py >= 0 && py <= height) {
          ctx.beginPath();
          ctx.strokeStyle = star.color;
          ctx.lineWidth = Math.min(2.0, (1 - star.z / width) * 2.5);
          ctx.moveTo(ppx, ppy);
          ctx.lineTo(px, py);
          ctx.stroke();
        }
      }

      animationFrameId = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 0,
        pointerEvents: "none",
        background: "#10151c"
      }}
    />
  );
}
