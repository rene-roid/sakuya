import { useEffect, useRef } from 'react';

const COLORS = ['#8b5cf6', '#f43f5e', '#22c55e', '#eab308', '#3b82f6', '#ec4899', '#f97316'];
const DURATION = 4200;
const PARTICLES_PER_BURST = 55;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  vr: number;
  life: number;
}

/** A cannon-style burst from a screen corner, shooting steeply upward and inward. */
function burst(x: number, y: number, direction: 1 | -1): Particle[] {
  return Array.from({ length: PARTICLES_PER_BURST }, () => {
    const angle = (55 + Math.random() * 35) * (Math.PI / 180);
    const speed = 14 + Math.random() * 14;
    return {
      x,
      y,
      vx: Math.cos(angle) * speed * direction,
      vy: -Math.sin(angle) * speed,
      size: 5 + Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * 360,
      vr: (Math.random() - 0.5) * 28,
      life: 1,
    };
  });
}

/** Full-screen party-popper confetti exploding from both bottom corners. Purely cosmetic — no interaction. */
export function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    let particles: Particle[] = [];
    let raf = 0;
    const start = performance.now();

    const spawn = () => {
      particles = particles.concat(
        burst(0, canvas.height, 1),
        burst(canvas.width, canvas.height, -1),
      );
    };
    spawn();
    const secondBurst = setTimeout(spawn, 350);
    const thirdBurst = setTimeout(spawn, 750);

    const tick = (now: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.vy += 0.35;
        p.vx *= 0.995;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vr;
        p.life -= 0.008;
      });
      particles = particles.filter((p) => p.life > 0 && p.y < canvas.height + 40);
      for (const p of particles) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (now - start < DURATION) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(secondBurst);
      clearTimeout(thirdBurst);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-[96] h-full w-full" />;
}
