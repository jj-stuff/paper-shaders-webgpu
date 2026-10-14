'use client';

import { useMemo, type CSSProperties } from 'react';
import { WebGPUShaderCanvas, type ShaderUniformEnv } from './mount';
import { shaderColor } from './color';
import {
  wgslConstants,
  wgslRotate,
  wgslHash11,
  wgslSimplexNoise,
  wgslTextureRandomizerR,
  wgslSizingVertex,
} from './wgsl-utils';

export type GrainGradientShape = 'wave' | 'dots' | 'truchet' | 'corners' | 'ripple' | 'blob' | 'sphere';
export type ShaderFit = 'none' | 'contain' | 'cover';

const SHAPES: Record<GrainGradientShape, number> = { wave: 1, dots: 2, truchet: 3, corners: 4, ripple: 5, blob: 6, sphere: 7 };
const FITS: Record<ShaderFit, number> = { none: 0, contain: 1, cover: 2 };
const UNIFORM_FLOATS = 52; // 50 values plus the 8-byte trailing uniform-struct padding.

// WGSL port of paper-shaders' grain-gradient (grain-gradient.ts upstream).
// The vertex stage ports the upstream vertex-shader.js sizing math; keeping
// it faithful is what makes all 7 shapes (not just full-bleed ones) render
// at the same scale and position as the WebGL original.
export const grainGradientShader = /* wgsl */ `
struct Uniforms {
  colors: array<vec4<f32>, 7>,
  colorBack: vec4<f32>,
  resolution: vec2<f32>,
  pixelRatio: f32,
  time: f32,
  colorsCount: f32,
  softness: f32,
  intensity: f32,
  noise: f32,
  shape: f32,
  fit: f32,
  scale: f32,
  rotation: f32,
  offsetX: f32,
  offsetY: f32,
  originX: f32,
  originY: f32,
  worldWidth: f32,
  worldHeight: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var noiseTexture: texture_2d<f32>;
@group(0) @binding(2) var noiseSampler: sampler;

${wgslConstants}
${wgslRotate}
${wgslHash11}
${wgslSimplexNoise}
${wgslTextureRandomizerR}
${wgslSizingVertex}

fn fbmR(aIn: vec2<f32>, bIn: vec2<f32>, cIn: vec2<f32>, dIn: vec2<f32>) -> vec4<f32> {
  var amplitude = 0.2;
  var total = vec4<f32>(0.0);
  var a = aIn;
  var b = bIn;
  var c = cIn;
  var d = dIn;
  for (var i = 0; i < 3; i = i + 1) {
    a = rotate(a, 0.3); b = rotate(b, 0.3); c = rotate(c, 0.3); d = rotate(d, 0.3);
    total += vec4<f32>(valueNoiseR(a), valueNoiseR(b), valueNoiseR(c), valueNoiseR(d)) * amplitude;
    a *= 1.99; b *= 1.99; c *= 1.99; d *= 1.99;
    amplitude *= 0.6;
  }
  return total;
}

fn truchet(uvIn: vec2<f32>, idxIn: f32) -> vec2<f32> {
  let idx = fract((idxIn - 0.5) * 2.0);
  if (idx > 0.75) { return vec2<f32>(1.0) - uvIn; }
  if (idx > 0.5) { return vec2<f32>(1.0 - uvIn.x, uvIn.y); }
  if (idx > 0.25) { return vec2<f32>(uvIn.x, 1.0 - uvIn.y); }
  return uvIn;
}

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> SizedVertexOutput {
  return sizedVertex(index);
}

@fragment
fn fs_main(input: SizedVertexOutput) -> @location(0) vec4<f32> {
  var time = 0.1 * (u.time + 7.0);

  let radians = u.rotation * PI / 180.0;
  let graphicRotation = mat2x2<f32>(vec2<f32>(cos(radians), sin(radians)), vec2<f32>(-sin(radians), cos(radians)));
  let graphicOffset = vec2<f32>(-u.offsetX, u.offsetY);
  var shapeUV: vec2<f32>;
  var grainUV: vec2<f32>;

  if (u.shape > 3.5) {
    shapeUV = input.objectUV;
    // inverse transform so the grain respects originXY, as upstream
    grainUV = transpose(graphicRotation) * shapeUV;
    grainUV *= u.scale;
    grainUV -= graphicOffset;
    grainUV *= input.objectBoxSize;
    grainUV *= 0.7;
  } else {
    shapeUV = 0.5 * input.patternUV;
    grainUV = 100.0 * input.patternUV;
    grainUV = transpose(graphicRotation) * grainUV;
    grainUV *= u.scale;
    if (u.fit > 0.0) {
      let givenBoxSize = max(vec2<f32>(u.worldWidth, u.worldHeight), vec2<f32>(1.0)) * u.pixelRatio;
      let boxGivenSize = vec2<f32>(
        select(givenBoxSize.x, u.resolution.x, u.worldWidth == 0.0),
        select(givenBoxSize.y, u.resolution.y, u.worldHeight == 0.0)
      );
      let ratio = boxGivenSize.x / boxGivenSize.y;
      let noFitBoxWidth = ratio * min(boxGivenSize.x / ratio, boxGivenSize.y);
      grainUV /= (noFitBoxWidth / input.patternBoxSize.x);
    }
    let patternBoxScale = u.resolution / input.patternBoxSize;
    grainUV -= graphicOffset / patternBoxScale;
    grainUV *= 1.6;
  }

  var shape: f32;
  if (u.shape < 1.5) {
    // Sine wave
    let wave = cos(0.5 * shapeUV.x - 4.0 * time) * sin(1.5 * shapeUV.x + 2.0 * time) * (0.75 + 0.25 * cos(6.0 * time));
    shape = 1.0 - smoothstep(-1.0, 1.0, shapeUV.y + wave);
  } else if (u.shape < 2.5) {
    // Grid (dots)
    let stripe = floor(2.0 * shapeUV.x / TWO_PI);
    let random = sign(hash11(stripe * 100.0) - 0.5) * pow(4.0 * abs(hash11(stripe * 100.0)), 0.3);
    shape = pow(abs(sin(shapeUV.x) * cos(shapeUV.y - 5.0 * random * time)), 4.0);
  } else if (u.shape < 3.5) {
    // Truchet pattern
    let n = (valueNoiseR(shapeUV * 0.4 - 3.75 * time) - 0.5) * 0.1;
    let tileUV = (shapeUV + vec2<f32>(10.0, 0.0)) * 0.6;
    let tile = truchet(fract(tileUV), randomR(floor(tileUV)));
    let a = length(tile);
    let b = length(tile - vec2<f32>(1.0));
    shape = smoothstep(0.2, 0.55, a + n) * (1.0 - smoothstep(0.45, 0.8, a - n));
    shape += smoothstep(0.2, 0.55, b + n) * (1.0 - smoothstep(0.45, 0.8, b - n));
    shape = pow(shape, 1.5);
  } else if (u.shape < 4.5) {
    // Corners
    var uv = shapeUV * 0.6;
    let outer = vec2<f32>(0.5);
    let first = smoothstep(vec2<f32>(0.0), outer, uv + vec2<f32>(0.1 + 0.1 * sin(3.0 * time), 0.2 - 0.1 * sin(5.25 * time)));
    let second = smoothstep(vec2<f32>(0.0), outer, 1.0 - uv);
    shape = 1.0 - first.x * first.y * second.x * second.y;
    uv = -uv;
    let third = smoothstep(vec2<f32>(0.0), outer, uv + vec2<f32>(0.1 + 0.1 * sin(3.0 * time), 0.2 - 0.1 * cos(5.25 * time)));
    let fourth = smoothstep(vec2<f32>(0.0), outer, 1.0 - uv);
    shape = 1.0 - smoothstep(0.0, 1.0, shape - third.x * third.y * fourth.x * fourth.y);
  } else if (u.shape < 5.5) {
    // Ripple
    shape = sin(pow(length(0.8 * shapeUV), 1.2) * 5.0 - 3.0 * time) * 0.5 + 0.5;
  } else if (u.shape < 6.5) {
    // Blob
    time *= 2.0;
    let f1 = 0.25 * vec2<f32>(1.3 * sin(time), 0.2 + 1.3 * cos(0.6 * time + 4.0));
    let f2 = 0.2 * vec2<f32>(1.2 * sin(-time), 1.3 * sin(1.6 * time));
    let f3 = 0.25 * vec2<f32>(1.7 * cos(-0.6 * time), cos(-1.6 * time));
    let f4 = 0.3 * vec2<f32>(1.4 * cos(0.8 * time), 1.2 * sin(-0.6 * time - 3.0));
    shape = 0.5 * pow(1.0 - clamp(length(shapeUV + f1), 0.0, 1.0), 5.0);
    shape += 0.5 * pow(1.0 - clamp(length(shapeUV + f2), 0.0, 1.0), 5.0);
    shape += 0.5 * pow(1.0 - clamp(length(shapeUV + f3), 0.0, 1.0), 5.0);
    shape += 0.5 * pow(1.0 - clamp(length(shapeUV + f4), 0.0, 1.0), 5.0);
    shape = mix(0.0, smoothstep(0.0, 0.9, shape), smoothstep(0.25, 0.3, shape));
  } else {
    // Sphere
    let sphereUV = shapeUV * 2.0;
    let d = 1.0 - dot(sphereUV, sphereUV);
    let normal = vec3<f32>(sphereUV, sqrt(max(d, 0.0)));
    let light = normalize(vec3<f32>(cos(1.5 * time), 0.8, sin(1.25 * time)));
    shape = (0.5 + 0.5 * dot(light, normal)) * step(0.0, d);
  }

  let baseNoise = snoise(grainUV * 0.5);
  let fbm = fbmR(0.002 * grainUV + 10.0, 0.003 * grainUV, 0.001 * grainUV, rotate(0.4 * grainUV, 2.0));
  let grain = baseNoise * snoise(grainUV * 0.2) - fbm.x - fbm.y;
  let noise = clamp(0.75 * baseNoise - fbm.w - fbm.z, 0.0, 1.0);
  let colorCount = max(u.colorsCount, 1.0);
  shape += u.intensity * 2.0 / colorCount * (grain + 0.5) + u.noise * 10.0 / colorCount * noise;

  let aa = fwidth(shape);
  shape = clamp(shape - 0.5 / colorCount, 0.0, 1.0);
  let totalShape = smoothstep(0.0, u.softness + 2.0 * aa, clamp(shape * colorCount, 0.0, 1.0));
  let mixer = shape * (colorCount - 1.0);
  var gradient = vec4<f32>(u.colors[0].rgb * u.colors[0].a, u.colors[0].a);
  let lastColor = i32(colorCount) - 1;
  for (var i = 1; i < 7; i = i + 1) {
    if (i > lastColor) { break; }
    let localT = smoothstep(0.5 - 0.5 * u.softness - aa, 0.5 + 0.5 * u.softness + aa, clamp(mixer - f32(i - 1), 0.0, 1.0));
    let next = u.colors[u32(i)];
    gradient = mix(gradient, vec4<f32>(next.rgb * next.a, next.a), localT);
  }

  let alpha = gradient.a * totalShape;
  let background = u.colorBack.rgb * u.colorBack.a;
  return vec4<f32>(gradient.rgb * totalShape + background * (1.0 - alpha), alpha + u.colorBack.a * (1.0 - alpha));
}
`;

export interface WebGPUGrainGradientProps {
  className?: string;
  style?: CSSProperties;
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  speed?: number;
  frame?: number;
  colorBack?: string;
  colors?: string[];
  softness?: number;
  intensity?: number;
  noise?: number;
  shape?: GrainGradientShape;
  fit?: ShaderFit;
  scale?: number;
  rotation?: number;
  originX?: number;
  originY?: number;
  offsetX?: number;
  offsetY?: number;
  worldWidth?: number;
  worldHeight?: number;
  maxPixelCount?: number;
  /** Fires when WebGPU cannot render (no adapter, device/compile/pipeline failure, device loss). */
  onRenderFailed?: () => void;
}

export function WebGPUGrainGradient({
  className,
  style,
  width,
  height,
  speed = 1,
  frame = 0,
  colorBack = '#000000',
  colors = ['#7300ff', '#eba8ff', '#00bfff', '#2a00ff'],
  softness = 0.5,
  intensity = 0.5,
  noise = 0.25,
  shape = 'corners',
  fit = 'contain',
  scale = 1,
  rotation = 0,
  originX = 0.5,
  originY = 0.5,
  offsetX = 0,
  offsetY = 0,
  worldWidth = 0,
  worldHeight = 0,
  maxPixelCount = 1_500_000,
  onRenderFailed,
}: WebGPUGrainGradientProps) {
  const packUniforms = useMemo(() => {
    const background = shaderColor(colorBack);
    const parsedColors = colors.slice(0, 7).map(shaderColor);
    const colorCount = Math.max(parsedColors.length, 1);
    return (data: Float32Array, env: ShaderUniformEnv) => {
      parsedColors.forEach((color, index) => data.set(color, index * 4));
      if (parsedColors.length === 0) data.set(background, 0);
      data.set(background, 28);
      data[32] = env.width;
      data[33] = env.height;
      data[34] = env.pixelRatio;
      data[35] = env.time;
      data[36] = colorCount;
      data[37] = softness;
      data[38] = intensity;
      data[39] = noise;
      data[40] = SHAPES[shape];
      data[41] = FITS[fit];
      data[42] = scale;
      data[43] = rotation;
      data[44] = offsetX;
      data[45] = offsetY;
      data[46] = originX;
      data[47] = originY;
      data[48] = worldWidth;
      data[49] = worldHeight;
    };
  }, [colorBack, colors, softness, intensity, noise, shape, fit, scale, rotation, offsetX, offsetY, originX, originY, worldWidth, worldHeight]);

  return (
    <WebGPUShaderCanvas
      className={className}
      style={style}
      width={width}
      height={height}
      shader={grainGradientShader}
      uniformFloatCount={UNIFORM_FLOATS}
      packUniforms={packUniforms}
      usesNoiseTexture
      speed={speed}
      frame={frame}
      maxPixelCount={maxPixelCount}
      backgroundColor={colorBack}
      onRenderFailed={onRenderFailed}
    />
  );
}
