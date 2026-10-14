import { createRoot, type Root } from 'react-dom/client';
import { Shader, GRAIN_SHAPES, DITHER_SHAPES, DITHER_TYPES, type Kind } from './shared';

// Pixel-diffs the WebGL original against the WebGPU port on a frozen frame.
// Both canvases are read back inside the task that drew them: WebGL via
// preserveDrawingBuffer (forced below), WebGPU via a hook after queue.submit.
const W = 480, H = 320, FRAME = 4000;

const origGetContext = HTMLCanvasElement.prototype.getContext;
(HTMLCanvasElement.prototype as any).getContext = function (type: string, opts?: any) {
  return origGetContext.call(this, type, type.startsWith('webgl') ? { ...opts, preserveDrawingBuffer: true } : opts);
};

let onSubmit: (() => void) | null = null;
const origSubmit = ((globalThis as any).GPUQueue.prototype).submit;
((globalThis as any).GPUQueue.prototype).submit = function (...args: any[]) {
  const r = origSubmit.apply(this, args);
  onSubmit?.();
  return r;
};

const stage = document.getElementById('stage')!;
const cell = (label: string) => {
  const el = document.createElement('div');
  stage.appendChild(el);
  return el;
};

function snapshot(c: HTMLCanvasElement) {
  const t = document.createElement('canvas');
  t.width = W * 2; t.height = H * 2;
  const g = t.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(c, 0, 0, t.width, t.height);
  return g.getImageData(0, 0, t.width, t.height).data;
}

async function compare(kind: Kind, shape: string, type?: any) {
  const host = cell('x');
  const root: Root = createRoot(host);
  const el = document.createElement('div');
  host.appendChild(el);
  // Two shaders side by side in one root.
  root.render(
    <div style={{ display: 'flex' }}>
      <div data-e="webgl"><Shader engine="webgl" kind={kind} shape={shape} type={type} width={W} height={H} speed={0} frame={FRAME} /></div>
      <div data-e="webgpu"><Shader engine="webgpu" kind={kind} shape={shape} type={type} width={W} height={H} speed={0} frame={FRAME} /></div>
    </div>
  );
  const get = (e: string) => host.querySelector(`[data-e=${e}] canvas`) as HTMLCanvasElement | null;
  for (let i = 0; i < 100 && !(get('webgl')?.width && get('webgpu')?.width); i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 600));
  const gl = get('webgl')!;
  const gpu = get('webgpu')!;
  if (!gl?.width || !gpu?.width) { root.unmount(); host.remove(); return { kind, shape, type: type ?? '', error: `canvas not ready (webgl ${gl?.width}, webgpu ${gpu?.width})` }; }
  const a = snapshot(gl);
  // The speed=0 loop stops after one frame in the port only under reduced motion,
  // so wait for the next submit and read inside it.
  const b = await new Promise<Uint8ClampedArray>((resolve) => {
    onSubmit = () => { onSubmit = null; resolve(snapshot(gpu)); };
  });
  let sum = 0, over = 0, max = 0, blankA = 0, blankB = 0;
  const px = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(a[i + k] - b[i + k]));
    sum += d; if (d > 8) over++; if (d > max) max = d;
    if (a[i + 3] === 0) blankA++; if (b[i + 3] === 0) blankB++;
  }
  // Grain and random dither use a per-pixel noise that is not bit-identical between
  // ports, so also compare 16px block averages, which isolates structure from noise.
  const BW = W * 2, BS = 16;
  let bsum = 0, bmax = 0, bn = 0;
  for (let by = 0; by < (H * 2) / BS; by++) for (let bx = 0; bx < BW / BS; bx++) {
    let d = 0;
    for (let k = 0; k < 3; k++) {
      let sa = 0, sb = 0;
      for (let y = 0; y < BS; y++) for (let x = 0; x < BS; x++) { const i = ((by * BS + y) * BW + bx * BS + x) * 4 + k; sa += a[i]; sb += b[i]; }
      d = Math.max(d, Math.abs(sa - sb) / (BS * BS));
    }
    bsum += d; bn++; if (d > bmax) bmax = d;
  }
  root.unmount(); host.remove();
  return { kind, shape, type: type ?? '', blockMean: +(bsum / bn).toFixed(2), blockMax: +bmax.toFixed(1), meanDiff: +(sum / px).toFixed(2), pctOver8: +((over / px) * 100).toFixed(2), maxDiff: max, blankWebGL: blankA === px, blankWebGPU: blankB === px };
}

async function main() {
  const results: any[] = [];
  const out = document.getElementById('out')!;
  const safe = async (...a: Parameters<typeof compare>) => { try { return await compare(...a); } catch (e) { return { kind: a[0], shape: a[1], type: a[2] ?? '', error: String(e) }; } };
  for (const s of GRAIN_SHAPES) results.push(await safe('grain', s));
  for (const s of DITHER_SHAPES) for (const t of DITHER_TYPES) results.push(await safe('dither', s, t));
  (window as any).__results = results;
  out.textContent = JSON.stringify(results);
}
main();
