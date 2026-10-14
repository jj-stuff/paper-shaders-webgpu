// WGSL ports of paper-shaders' shared GLSL chunks (shader-utils.ts upstream).
// Composed into shader sources as template strings, same as the original.

export const wgslConstants = /* wgsl */ `
const PI: f32 = 3.14159265358979323846;
const TWO_PI: f32 = 6.28318530718;
`;

export const wgslRotate = /* wgsl */ `
fn rotate(uv: vec2<f32>, th: f32) -> vec2<f32> {
  return mat2x2<f32>(vec2<f32>(cos(th), sin(th)), vec2<f32>(-sin(th), cos(th))) * uv;
}
`;

export const wgslHash11 = /* wgsl */ `
fn hash11(pIn: f32) -> f32 {
  var p = fract(pIn * 0.3183099) + 0.1;
  p *= p + 19.19;
  return fract(p * p);
}
`;

export const wgslHash21 = /* wgsl */ `
fn hash21(pIn: vec2<f32>) -> f32 {
  var p = fract(pIn * vec2<f32>(0.3183099, 0.3678794)) + 0.1;
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}
`;

// Ashima 2D simplex noise, same constants as the GLSL original.
export const wgslSimplexNoise = /* wgsl */ `
fn permute(x: vec3<f32>) -> vec3<f32> {
  let y = (x * 34.0 + 1.0) * x;
  return y - floor(y / 289.0) * 289.0;
}

fn snoise(v: vec2<f32>) -> f32 {
  let c = vec4<f32>(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  let i = floor(v + dot(v, c.yy));
  let x0 = v - i + dot(i, c.xx);
  let i1 = select(vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), x0.x > x0.y);
  var x12 = x0.xyxy + c.xxzz;
  x12.x = x12.x - i1.x;
  x12.y = x12.y - i1.y;
  let iMod = i - floor(i / 289.0) * 289.0;
  let p = permute(permute(iMod.y + vec3<f32>(0.0, i1.y, 1.0)) + iMod.x + vec3<f32>(0.0, i1.x, 1.0));
  var m = max(0.5 - vec3<f32>(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3<f32>(0.0));
  m *= m;
  m *= m;
  let x = 2.0 * fract(p * c.www) - 1.0;
  let h = abs(x) - 0.5;
  let a0 = x - floor(x + 0.5);
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  let g = vec3<f32>(a0.x * x0.x + h.x * x0.y, a0.y * x12.x + h.y * x12.y, a0.z * x12.z + h.z * x12.w);
  return 130.0 * dot(m, g);
}
`;

// Texture-backed randomizer (needs noiseTexture/noiseSampler at bindings 1/2).
export const wgslTextureRandomizerR = /* wgsl */ `
fn randomR(p: vec2<f32>) -> f32 {
  return textureSampleLevel(noiseTexture, noiseSampler, fract(floor(p) / 100.0 + 0.5), 0.0).r;
}

fn valueNoiseR(st: vec2<f32>) -> f32 {
  let i = floor(st);
  let f = fract(st);
  let a = randomR(i);
  let b = randomR(i + vec2<f32>(1.0, 0.0));
  let c = randomR(i + vec2<f32>(0.0, 1.0));
  let d = randomR(i + vec2<f32>(1.0, 1.0));
  let q = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, q.x), mix(c, d, q.x), q.y);
}
`;

/**
 * Port of paper-shaders' vertex-shader.js sizing math for the object and
 * pattern coordinate systems (responsive/image UVs omitted until a shader
 * needs them). Requires the uniform struct to expose: resolution, pixelRatio,
 * fit, scale, rotation, offsetX/Y, originX/Y, worldWidth/Height as \`u.<name>\`.
 *
 * Emits \`SizedVertexOutput\` and \`sizedVertex(index)\`:
 * - objectUV: aspect-locked square box UVs (shapes drawn as one object)
 * - patternUV: world-pixel UVs / 100 (repeating patterns), same x100
 *   convention as upstream to dodge precision issues
 * - objectBoxSize / patternBoxSize: box sizes in physical pixels
 *
 * WebGPU's NDC orientation matches GL's for rendering (+y up), so the
 * interpolated \`position * 0.5\` UVs line up with the GLSL original without
 * a y-flip; only gl_FragCoord-based math needs flipping (see dithering).
 */
export const wgslSizingVertex = /* wgsl */ `
struct SizedVertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) objectUV: vec2<f32>,
  @location(1) patternUV: vec2<f32>,
  @location(2) objectBoxSize: vec2<f32>,
  @location(3) patternBoxSize: vec2<f32>,
};

// Returns (box width, box height, no-fit box width) for a given aspect ratio.
fn getBoxSize(boxRatio: f32, givenBoxSize: vec2<f32>) -> vec3<f32> {
  var boxWidth = boxRatio * min(givenBoxSize.x / boxRatio, givenBoxSize.y);
  let noFitBoxWidth = boxWidth;
  if (u.fit == 1.0) { // contain
    boxWidth = boxRatio * min(u.resolution.x / boxRatio, u.resolution.y);
  } else if (u.fit == 2.0) { // cover
    boxWidth = boxRatio * max(u.resolution.x / boxRatio, u.resolution.y);
  }
  return vec3<f32>(boxWidth, boxWidth / boxRatio, noFitBoxWidth);
}

fn sizedVertex(index: u32) -> SizedVertexOutput {
  // Fullscreen triangle (-1,-1) (3,-1) (-1,3) from the vertex index without
  // runtime-indexing a let-bound array, which stricter WGSL compilers
  // (WebKit/Safari) reject even though Chrome's accepts it.
  let pos = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u)) * 2.0 - 1.0;
  var out: SizedVertexOutput;
  out.position = vec4<f32>(pos, 0.0, 1.0);

  let uv = pos * 0.5;
  let boxOrigin = vec2<f32>(0.5 - u.originX, u.originY - 0.5);
  let givenBoxSize = max(vec2<f32>(u.worldWidth, u.worldHeight), vec2<f32>(1.0)) * u.pixelRatio;
  let r = u.rotation * PI / 180.0;
  let graphicRotation = mat2x2<f32>(vec2<f32>(cos(r), sin(r)), vec2<f32>(-sin(r), cos(r)));
  let graphicOffset = vec2<f32>(-u.offsetX, u.offsetY);

  let sizedBox = vec2<f32>(
    select(givenBoxSize.x, u.resolution.x, u.worldWidth == 0.0),
    select(givenBoxSize.y, u.resolution.y, u.worldHeight == 0.0)
  );

  let objectBox = getBoxSize(1.0, sizedBox);
  out.objectBoxSize = objectBox.xy;
  let objectWorldScale = u.resolution / objectBox.xy;
  var objectUV = uv * objectWorldScale;
  objectUV += boxOrigin * (objectWorldScale - 1.0);
  objectUV += graphicOffset;
  objectUV /= u.scale;
  out.objectUV = graphicRotation * objectUV;

  let patternBoxRatio = sizedBox.x / sizedBox.y;
  let patternBox = getBoxSize(patternBoxRatio, sizedBox);
  out.patternBoxSize = patternBox.xy;
  let patternBoxScale = u.resolution / patternBox.xy;
  var patternUV = uv;
  patternUV += graphicOffset / patternBoxScale;
  patternUV += boxOrigin;
  patternUV -= boxOrigin / patternBoxScale;
  patternUV *= u.resolution;
  patternUV /= u.pixelRatio;
  if (u.fit > 0.0) {
    patternUV *= patternBox.z / patternBox.x;
  }
  patternUV /= u.scale;
  patternUV = graphicRotation * patternUV;
  patternUV += boxOrigin / patternBoxScale;
  patternUV -= boxOrigin;
  out.patternUV = patternUV * 0.01;
  return out;
}
`;
