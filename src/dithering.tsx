'use client';

import { useMemo, type CSSProperties } from 'react';
import { WebGPUShaderCanvas, type ShaderUniformEnv } from './mount';
import { shaderColor } from './color';
import { wgslConstants, wgslHash11, wgslHash21, wgslSimplexNoise } from './wgsl-utils';
import type { ShaderFit } from './grain-gradient';

export type DitheringShape = 'simplex' | 'warp' | 'dots' | 'wave' | 'ripple' | 'swirl' | 'sphere';
export type DitheringType = 'random' | '2x2' | '4x4' | '8x8';

const SHAPES: Record<DitheringShape, number> = { simplex: 1, warp: 2, dots: 3, wave: 4, ripple: 5, swirl: 6, sphere: 7 };
const TYPES: Record<DitheringType, number> = { random: 1, '2x2': 2, '4x4': 3, '8x8': 4 };
const FITS: Record<ShaderFit, number> = { none: 0, contain: 1, cover: 2 };
const UNIFORM_FLOATS = 24;

// WGSL port of paper-shaders' dithering (dithering.ts upstream). Upstream does
// all sizing in the fragment shader from gl_FragCoord so the dither grid stays
// in physical pixels; the only WebGPU-specific change is flipping the y of
// @builtin(position), which is top-down where gl_FragCoord is bottom-up.
export const ditheringShader = /* wgsl */ `
struct Uniforms {
  colorBack: vec4<f32>,
  colorFront: vec4<f32>,
  resolution: vec2<f32>,
  pixelRatio: f32,
  time: f32,
  shape: f32,
  ditherType: f32,
  pxSize: f32,
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

${wgslConstants}
${wgslHash11}
${wgslHash21}
${wgslSimplexNoise}

fn getSimplexNoise(uv: vec2<f32>, t: f32) -> f32 {
  return 0.5 * snoise(uv - vec2<f32>(0.0, 0.3 * t)) + 0.5 * snoise(2.0 * uv + vec2<f32>(0.0, 0.32 * t));
}

fn getBayerValue(uv: vec2<f32>, size: i32) -> f32 {
  let cell = vec2<i32>(fract(uv / f32(size)) * f32(size));
  let index = cell.y * size + cell.x;
  if (size == 2) {
    var bayer = array<i32, 4>(0, 2, 3, 1);
    return f32(bayer[index]) / 4.0;
  }
  if (size == 4) {
    var bayer = array<i32, 16>(
      0, 8, 2, 10,
      12, 4, 14, 6,
      3, 11, 1, 9,
      15, 7, 13, 5
    );
    return f32(bayer[index]) / 16.0;
  }
  if (size == 8) {
    var bayer = array<i32, 64>(
      0, 32, 8, 40, 2, 34, 10, 42,
      48, 16, 56, 24, 50, 18, 58, 26,
      12, 44, 4, 36, 14, 46, 6, 38,
      60, 28, 52, 20, 62, 30, 54, 22,
      3, 35, 11, 43, 1, 33, 9, 41,
      51, 19, 59, 27, 49, 17, 57, 25,
      15, 47, 7, 39, 13, 45, 5, 37,
      63, 31, 55, 23, 61, 29, 53, 21
    );
    return f32(bayer[index]) / 64.0;
  }
  return 0.0;
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOutput {
  // Fullscreen triangle without runtime-indexing a let-bound array, which
  // stricter WGSL compilers (WebKit/Safari) reject.
  let pos = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u)) * 2.0 - 1.0;
  var out: VertexOutput;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let t = 0.5 * u.time;

  // gl_FragCoord equivalent: same x, y flipped to bottom-up.
  let fragCoord = vec2<f32>(input.position.x, u.resolution.y - input.position.y);

  let pxSize = u.pxSize * u.pixelRatio;
  let pxSizeUV = (fragCoord - 0.5 * u.resolution) / pxSize;
  let canvasPixelizedUV = (floor(pxSizeUV) + 0.5) * pxSize;
  let normalizedUV = canvasPixelizedUV / u.resolution;

  let ditheringNoiseUV = canvasPixelizedUV;
  var shapeUV = normalizedUV;

  let boxOrigin = vec2<f32>(0.5 - u.originX, u.originY - 0.5);
  let givenBoxSize = max(vec2<f32>(u.worldWidth, u.worldHeight), vec2<f32>(1.0)) * u.pixelRatio;
  let r = u.rotation * PI / 180.0;
  let graphicRotation = mat2x2<f32>(vec2<f32>(cos(r), sin(r)), vec2<f32>(-sin(r), cos(r)));
  let graphicOffset = vec2<f32>(-u.offsetX, u.offsetY);

  let boxSize = vec2<f32>(
    select(givenBoxSize.x, u.resolution.x, u.worldWidth == 0.0),
    select(givenBoxSize.y, u.resolution.y, u.worldHeight == 0.0)
  );

  if (u.shape > 3.5) {
    var objectBoxWidth = min(boxSize.x, boxSize.y); // fit = none
    if (u.fit == 1.0) { // contain
      objectBoxWidth = min(u.resolution.x, u.resolution.y);
    } else if (u.fit == 2.0) { // cover
      objectBoxWidth = max(u.resolution.x, u.resolution.y);
    }
    let objectWorldScale = u.resolution / vec2<f32>(objectBoxWidth);

    shapeUV *= objectWorldScale;
    shapeUV += boxOrigin * (objectWorldScale - 1.0);
    shapeUV += graphicOffset;
    shapeUV /= u.scale;
    shapeUV = graphicRotation * shapeUV;
  } else {
    let patternBoxRatio = givenBoxSize.x / givenBoxSize.y;
    var patternBoxWidth = patternBoxRatio * min(boxSize.x / patternBoxRatio, boxSize.y); // fit = none
    let patternWorldNoFitBoxWidth = patternBoxWidth;
    if (u.fit == 1.0) { // contain
      patternBoxWidth = patternBoxRatio * min(u.resolution.x / patternBoxRatio, u.resolution.y);
    } else if (u.fit == 2.0) { // cover
      patternBoxWidth = patternBoxRatio * max(u.resolution.x / patternBoxRatio, u.resolution.y);
    }
    let patternBoxSize = vec2<f32>(patternBoxWidth, patternBoxWidth / patternBoxRatio);
    let patternWorldScale = u.resolution / patternBoxSize;

    shapeUV += graphicOffset / patternWorldScale;
    shapeUV += boxOrigin;
    shapeUV -= boxOrigin / patternWorldScale;
    shapeUV *= u.resolution;
    shapeUV /= u.pixelRatio;
    if (u.fit > 0.0) {
      shapeUV *= (patternWorldNoFitBoxWidth / patternBoxSize.x);
    }
    shapeUV /= u.scale;
    shapeUV = graphicRotation * shapeUV;
    shapeUV += boxOrigin / patternWorldScale;
    shapeUV -= boxOrigin;
    shapeUV += 0.5;
  }

  var shape = 0.0;
  if (u.shape < 1.5) {
    // Simplex noise
    shapeUV *= 0.001;
    shape = 0.5 + 0.5 * getSimplexNoise(shapeUV, t);
    shape = smoothstep(0.3, 0.9, shape);
  } else if (u.shape < 2.5) {
    // Warp
    shapeUV *= 0.003;
    for (var i = 1.0; i < 6.0; i += 1.0) {
      shapeUV.x += 0.6 / i * cos(i * 2.5 * shapeUV.y + t);
      shapeUV.y += 0.6 / i * cos(i * 1.5 * shapeUV.x + t);
    }
    shape = 0.15 / max(0.001, abs(sin(t - shapeUV.y - shapeUV.x)));
    shape = smoothstep(0.02, 1.0, shape);
  } else if (u.shape < 3.5) {
    // Dots
    shapeUV *= 0.05;
    let stripeIdx = floor(2.0 * shapeUV.x / TWO_PI);
    var rand = hash11(stripeIdx * 10.0);
    rand = sign(rand - 0.5) * pow(0.1 + abs(rand), 0.4);
    shape = sin(shapeUV.x) * cos(shapeUV.y - 5.0 * rand * t);
    shape = pow(abs(shape), 6.0);
  } else if (u.shape < 4.5) {
    // Sine wave
    shapeUV *= 4.0;
    let wave = cos(0.5 * shapeUV.x - 2.0 * t) * sin(1.5 * shapeUV.x + t) * (0.75 + 0.25 * cos(3.0 * t));
    shape = 1.0 - smoothstep(-1.0, 1.0, shapeUV.y + wave);
  } else if (u.shape < 5.5) {
    // Ripple
    let dist = length(shapeUV);
    shape = sin(pow(dist, 1.7) * 7.0 - 3.0 * t) * 0.5 + 0.5;
  } else if (u.shape < 6.5) {
    // Swirl
    let l = length(shapeUV);
    let angle = 6.0 * atan2(shapeUV.y, shapeUV.x) + 4.0 * t;
    let twist = 1.2;
    let offset = 1.0 / pow(max(l, 1e-6), twist) + angle / TWO_PI;
    let mid = smoothstep(0.0, 1.0, pow(l, twist));
    shape = mix(0.0, fract(offset), mid);
  } else {
    // Sphere
    shapeUV *= 2.0;
    let d = 1.0 - dot(shapeUV, shapeUV);
    let pos = vec3<f32>(shapeUV, sqrt(max(0.0, d)));
    let lightPos = normalize(vec3<f32>(cos(1.5 * t), 0.8, sin(1.25 * t)));
    shape = 0.5 + 0.5 * dot(lightPos, pos);
    shape *= step(0.0, d);
  }

  var dithering = 0.0;
  switch (i32(floor(u.ditherType))) {
    case 1: { dithering = step(hash21(ditheringNoiseUV), shape); }
    case 2: { dithering = getBayerValue(pxSizeUV, 2); }
    case 3: { dithering = getBayerValue(pxSizeUV, 4); }
    default: { dithering = getBayerValue(pxSizeUV, 8); }
  }
  dithering -= 0.5;
  let res = step(0.5, shape + dithering);

  let fgColor = u.colorFront.rgb * u.colorFront.a;
  let bgColor = u.colorBack.rgb * u.colorBack.a;

  var color = fgColor * res;
  var opacity = u.colorFront.a * res;
  color += bgColor * (1.0 - opacity);
  opacity += u.colorBack.a * (1.0 - opacity);

  return vec4<f32>(color, opacity);
}
`;

export interface WebGPUDitheringProps {
  className?: string;
  style?: CSSProperties;
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  speed?: number;
  frame?: number;
  colorBack?: string;
  colorFront?: string;
  shape?: DitheringShape;
  type?: DitheringType;
  /** Dither grid pixel size (0.5 to 20), matches upstream's `size` param / u_pxSize uniform. */
  size?: number;
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

export function WebGPUDithering({
  className,
  style,
  width,
  height,
  speed = 1,
  frame = 0,
  colorBack = '#000000',
  colorFront = '#00b2ff',
  shape = 'sphere',
  type = '4x4',
  size = 2,
  fit = 'none',
  scale = 0.6,
  rotation = 0,
  originX = 0.5,
  originY = 0.5,
  offsetX = 0,
  offsetY = 0,
  worldWidth = 0,
  worldHeight = 0,
  maxPixelCount = 1_500_000,
  onRenderFailed,
}: WebGPUDitheringProps) {
  const packUniforms = useMemo(() => {
    const background = shaderColor(colorBack);
    const foreground = shaderColor(colorFront);
    return (data: Float32Array, env: ShaderUniformEnv) => {
      data.set(background, 0);
      data.set(foreground, 4);
      data[8] = env.width;
      data[9] = env.height;
      data[10] = env.pixelRatio;
      data[11] = env.time;
      data[12] = SHAPES[shape];
      data[13] = TYPES[type];
      data[14] = size;
      data[15] = FITS[fit];
      data[16] = scale;
      data[17] = rotation;
      data[18] = offsetX;
      data[19] = offsetY;
      data[20] = originX;
      data[21] = originY;
      data[22] = worldWidth;
      data[23] = worldHeight;
    };
  }, [colorBack, colorFront, shape, type, size, fit, scale, rotation, offsetX, offsetY, originX, originY, worldWidth, worldHeight]);

  return (
    <WebGPUShaderCanvas
      className={className}
      style={style}
      width={width}
      height={height}
      shader={ditheringShader}
      uniformFloatCount={UNIFORM_FLOATS}
      packUniforms={packUniforms}
      speed={speed}
      frame={frame}
      maxPixelCount={maxPixelCount}
      backgroundColor={colorBack}
      onRenderFailed={onRenderFailed}
    />
  );
}
