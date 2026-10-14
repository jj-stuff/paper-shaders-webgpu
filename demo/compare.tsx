import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Shader, GRAIN_SHAPES, DITHER_SHAPES, DITHER_TYPES, type Kind } from './shared';
import type { DitheringType } from 'paper-shaders-webgpu';

function Compare() {
  const q = new URLSearchParams(location.search);
  const [kind, setKind] = useState<Kind>(q.get('kind') === 'dither' ? 'dither' : 'grain');
  const [grain, setGrain] = useState(q.get('kind') === 'dither' ? 'corners' : q.get('shape') ?? 'corners');
  const [dither, setDither] = useState(q.get('kind') === 'dither' ? q.get('shape') ?? 'simplex' : 'simplex');
  const [type, setType] = useState<DitheringType>((q.get('type') as DitheringType) ?? '4x4');
  const speed = Number(q.get('speed') ?? 1);
  const frame = Number(q.get('frame') ?? 0);
  const shape = kind === 'grain' ? grain : dither;
  const shapes = kind === 'grain' ? GRAIN_SHAPES : DITHER_SHAPES;
  const hasGPU = 'gpu' in navigator;

  return (
    <>
      <h1 style={{ fontSize: 15, margin: '0 0 12px' }}>paper-shaders-webgpu: WebGL original vs WebGPU port</h1>
      {!hasGPU && <p className="warn">This browser has no WebGPU, so the right pane will stay empty.</p>}
      <div className="row">
        {(['grain', 'dither'] as Kind[]).map((k) => (
          <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{k === 'grain' ? 'grain gradient' : 'dithering'}</button>
        ))}
        <span>|</span>
        {shapes.map((s) => (
          <button key={s} aria-pressed={shape === s} onClick={() => (kind === 'grain' ? setGrain(s) : setDither(s))}>{s}</button>
        ))}
        {kind === 'dither' && (
          <select value={type} onChange={(e) => setType(e.target.value as DitheringType)}>
            {DITHER_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        )}
      </div>
      <div className="panes">
        {(['webgl', 'webgpu'] as const).map((engine) => (
          <figure key={engine}>
            <figcaption>{engine === 'webgl' ? 'WebGL (Paper Shaders original)' : 'WebGPU (this port)'}</figcaption>
            <Shader key={`${engine}-${kind}-${shape}-${type}`} engine={engine} kind={kind} shape={shape} type={type} width={480} height={320} speed={speed} frame={frame} />
          </figure>
        ))}
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Compare />);
