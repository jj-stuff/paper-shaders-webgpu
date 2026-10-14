import { GrainGradient, Dithering } from '@paper-design/shaders-react';
import {
  WebGPUGrainGradient,
  WebGPUDithering,
  type GrainGradientShape,
  type DitheringShape,
  type DitheringType,
} from 'paper-shaders-webgpu';

export const GRAIN_SHAPES: GrainGradientShape[] = ['wave', 'dots', 'truchet', 'corners', 'ripple', 'blob', 'sphere'];
export const DITHER_SHAPES: DitheringShape[] = ['simplex', 'warp', 'dots', 'wave', 'ripple', 'swirl', 'sphere'];
export const DITHER_TYPES: DitheringType[] = ['random', '2x2', '4x4', '8x8'];

// Vivid on purpose: divergences hide in subtle tones.
export const GRAIN_COLORS = ['#7300ff', '#eba8ff', '#00bfff', '#2a00ff'];
export const DITHER = { back: '#1a1230', front: '#7fffd4' };

export type Engine = 'webgl' | 'webgpu';
export type Kind = 'grain' | 'dither';

export interface ShaderProps {
  engine: Engine;
  kind: Kind;
  shape: string;
  type?: DitheringType;
  width: number | string;
  height: number | string;
  speed?: number;
  frame?: number;
  maxPixelCount?: number;
}

// Matches the WebGL original's pixel density to the port's so a comparison is
// pixel-for-pixel (Paper defaults to a 2x minimum, the port follows DPR).
const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

export function Shader({ engine, kind, shape, type = '4x4', width, height, speed = 1, frame = 0, maxPixelCount = 6_000_000 }: ShaderProps) {
  const style = { width, height };
  if (kind === 'grain') {
    const common = { style, colors: GRAIN_COLORS, colorBack: '#000000', softness: 0.5, intensity: 0.5, noise: 0.25, shape: shape as GrainGradientShape, speed, frame, maxPixelCount };
    return engine === 'webgl' ? <GrainGradient {...common} minPixelRatio={dpr} /> : <WebGPUGrainGradient {...common} />;
  }
  const common = { style, colorBack: DITHER.back, colorFront: DITHER.front, shape: shape as DitheringShape, type, size: 3, speed, frame, maxPixelCount };
  return engine === 'webgl' ? <Dithering {...common} minPixelRatio={dpr} /> : <WebGPUDithering {...common} />;
}
