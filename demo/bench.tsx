import { createRoot } from 'react-dom/client';
import { Shader, type Engine, type Kind } from './shared';

// Usage: bench.html?engine=webgl|webgpu&kind=grain|dither&shape=ripple&n=4&secs=8
// n identical full-stage shaders are stacked on one 960x640 stage, so GPU
// load scales with n while everything stays in the viewport (Paper's WebGL
// mount pauses offscreen instances, which would hide the cost).
const q = new URLSearchParams(location.search);
const engine = (q.get('engine') ?? 'webgpu') as Engine;
const kind = (q.get('kind') ?? 'grain') as Kind;
const shape = q.get('shape') ?? (kind === 'grain' ? 'ripple' : 'simplex');
const n = Number(q.get('n') ?? 1);
const secs = Number(q.get('secs') ?? 8);
const WARMUP_MS = 2000;

createRoot(document.getElementById('root')!).render(
  <>
    <div id="stage">
      {Array.from({ length: n }, (_, i) => (
        <Shader key={i} engine={engine} kind={kind} shape={shape} width={960} height={640} />
      ))}
    </div>
    <pre id="out">running {engine} {kind}/{shape} x{n} for {secs}s…</pre>
  </>
);

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function run() {
  let longTasks = 0;
  let longTaskMs = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { longTasks++; longTaskMs += e.duration; }
    }).observe({ entryTypes: ['longtask'] });
  } catch {}

  const deltas: number[] = [];
  const t0 = performance.now();
  let last = t0;
  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      if (now - t0 > WARMUP_MS) deltas.push(now - last);
      last = now;
      if (now - t0 < WARMUP_MS + secs * 1000) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });

  const sorted = [...deltas].sort((a, b) => a - b);
  const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const median = pct(sorted, 50);
  let adapter = '';
  try {
    const info = (await (navigator as any).gpu?.requestAdapter())?.info;
    adapter = info ? `${info.vendor} ${info.architecture} ${info.description}`.trim() : '';
  } catch {}
  const result = {
    engine, kind, shape, n,
    dpr: devicePixelRatio,
    frames: deltas.length,
    fps: +(1000 / mean).toFixed(1),
    medianMs: +median.toFixed(2),
    p95Ms: +pct(sorted, 95).toFixed(2),
    p99Ms: +pct(sorted, 99).toFixed(2),
    maxMs: +sorted[sorted.length - 1].toFixed(2),
    jank: deltas.filter((d) => d > median * 1.5).length,
    longTasks,
    longTaskMs: +longTaskMs.toFixed(0),
    adapter,
    ua: navigator.userAgent,
  };
  (window as any).__result = result;
  document.getElementById('out')!.textContent = JSON.stringify(result, null, 1);
}

setTimeout(run, 500);
