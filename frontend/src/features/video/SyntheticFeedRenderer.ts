interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  confidence: number;
}

/**
 * Renders a synthetic "camera view" onto a canvas: anonymous moving bounding boxes only — no
 * identity/face rendering, matching the product's privacy posture. Stands in for a real
 * WebRTC/LL-HLS decoded frame, which this mock has no camera hardware to produce. See
 * ARCHITECTURE.md for the real-gateway integration seam.
 */
export class SyntheticFeedRenderer {
  private dots: Dot[] = [];
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  private rand(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  private ensureDotCount(target: number, width: number, height: number): void {
    while (this.dots.length < target) {
      this.dots.push({
        x: this.rand() * width,
        y: height * 0.35 + this.rand() * height * 0.55,
        vx: (this.rand() - 0.5) * 1.2,
        vy: (this.rand() - 0.5) * 0.6,
        confidence: 0.62 + this.rand() * 0.37,
      });
    }
    if (this.dots.length > target) this.dots.length = target;
  }

  render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    opts: { cameraName: string; headcount: number; showBoxes: boolean; showConfidence: boolean; nowIso: string },
  ): void {
    const target = Math.max(0, Math.min(45, opts.headcount));
    this.ensureDotCount(target, width, height);

    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#0d1119');
    grad.addColorStop(1, '#05070b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(56,189,248,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.35);
    ctx.lineTo(width, height * 0.35);
    ctx.stroke();

    for (const dot of this.dots) {
      dot.x += dot.vx;
      dot.y += dot.vy;
      if (dot.x < 0 || dot.x > width) dot.vx *= -1;
      if (dot.y < height * 0.3 || dot.y > height * 0.95) dot.vy *= -1;
      dot.x = Math.max(0, Math.min(width, dot.x));
      dot.y = Math.max(height * 0.3, Math.min(height * 0.95, dot.y));

      const boxW = 14 + (dot.y / height) * 16;
      const boxH = boxW * 2;

      if (opts.showBoxes) {
        ctx.strokeStyle = 'rgba(56,189,248,0.85)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(dot.x - boxW / 2, dot.y - boxH, boxW, boxH);
        if (opts.showConfidence) {
          ctx.fillStyle = 'rgba(56,189,248,0.85)';
          ctx.font = '9px ui-monospace, monospace';
          ctx.fillText(dot.confidence.toFixed(2), dot.x - boxW / 2, dot.y - boxH - 3);
        }
      } else {
        ctx.fillStyle = 'rgba(148,163,184,0.85)';
        ctx.beginPath();
        ctx.ellipse(dot.x, dot.y - boxH / 2, boxW / 3, boxH / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(opts.cameraName, 8, 16);
    ctx.textAlign = 'right';
    ctx.fillText(opts.nowIso, width - 8, 16);
    ctx.textAlign = 'left';
  }
}
