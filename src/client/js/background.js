// ═══════════════════════════════════════════════════════════
// SCAN Generative Background — Particle Field
// ═══════════════════════════════════════════════════════════
//
// Canvas-rendered particle system behind the graph view.
//
// ~100 particles (scaled to viewport area / 12000):
//   • 5 domain colors, random alpha 0.1–0.5
//   • Slow drift velocity with 0.99 damping
//   • Sinusoidal alpha pulse (breathing effect)
//   • Mouse repulsion within 120px radius
//   • Inter-particle connections drawn when distance < 63px
//   • Toroidal wrap at viewport edges
//
// Renders at 40% opacity via CSS on the canvas element.
// pointer-events: none — does not intercept graph interactions.
//
// ═══════════════════════════════════════════════════════════
const BgCanvas = {
  canvas: null,
  ctx: null,
  particles: [],
  width: 0,
  height: 0,
  mouse: { x: -1000, y: -1000 },
  animFrame: null,

  init() {
    this.canvas = document.getElementById('bg-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    this.createParticles();
    this.bindEvents();
    this.animate();
  },

  resize() {
    this.width = this.canvas.parentElement.clientWidth;
    this.height = this.canvas.parentElement.clientHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  },

  createParticles() {
    const count = Math.floor((this.width * this.height) / 12000);
    this.particles = [];

    const colors = [
      'rgba(0, 240, 255, ',   // cyan
      'rgba(255, 0, 170, ',   // magenta
      'rgba(255, 170, 0, ',   // amber
      'rgba(0, 255, 136, ',   // lime
      'rgba(170, 68, 255, ',  // violet
    ];

    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.5 + 0.3,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: Math.random() * 0.4 + 0.1,
        pulseSpeed: Math.random() * 0.02 + 0.005,
        pulseOffset: Math.random() * Math.PI * 2,
      });
    }
  },

  bindEvents() {
    window.addEventListener('resize', () => {
      this.resize();
      this.createParticles();
    });

    document.querySelector('.main')?.addEventListener('mousemove', (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
    });

    document.querySelector('.main')?.addEventListener('mouseleave', () => {
      this.mouse.x = -1000;
      this.mouse.y = -1000;
    });
  },

  animate() {
    const t = Date.now() * 0.001;
    this.ctx.clearRect(0, 0, this.width, this.height);

    this.particles.forEach(p => {
      // Drift
      p.x += p.vx;
      p.y += p.vy;

      // Mouse repulsion (subtle)
      const dx = p.x - this.mouse.x;
      const dy = p.y - this.mouse.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 120) {
        const force = (120 - dist) / 120 * 0.3;
        p.vx += (dx / dist) * force;
        p.vy += (dy / dist) * force;
      }

      // Dampen velocity
      p.vx *= 0.99;
      p.vy *= 0.99;

      // Wrap
      if (p.x < 0) p.x = this.width;
      if (p.x > this.width) p.x = 0;
      if (p.y < 0) p.y = this.height;
      if (p.y > this.height) p.y = 0;

      // Pulse
      const pulse = Math.sin(t * p.pulseSpeed * 60 + p.pulseOffset) * 0.3 + 0.7;
      const alpha = p.alpha * pulse;

      // Draw
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      this.ctx.fillStyle = p.color + alpha.toFixed(2) + ')';
      this.ctx.fill();
    });

    // Draw faint connections between close particles
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.015)';
    this.ctx.lineWidth = 0.5;
    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const a = this.particles[i];
        const b = this.particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = dx * dx + dy * dy;
        if (d < 4000) {
          this.ctx.beginPath();
          this.ctx.moveTo(a.x, a.y);
          this.ctx.lineTo(b.x, b.y);
          this.ctx.stroke();
        }
      }
    }

    this.animFrame = requestAnimationFrame(() => this.animate());
  },

  destroy() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
  }
};
