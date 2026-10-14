// Fuzz-compare upstream GLSL sizing math against the WGSL port, both
// transcribed to JS line-by-line from their respective sources.

const PI = Math.PI;
const v2 = (x, y) => [x, y];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, b) => [a[0] * b[0], a[1] * b[1]];
const div = (a, b) => [a[0] / b[0], a[1] / b[1]];
const scale = (a, s) => [a[0] * s, a[1] * s];
// GLSL mat2(c, s, -s, c) * v  — columns (c,s) and (-s,c)
const rot = (v, r) => [Math.cos(r) * v[0] - Math.sin(r) * v[1], Math.sin(r) * v[0] + Math.cos(r) * v[1]];
// transpose of the same matrix * v
const rotT = (v, r) => [Math.cos(r) * v[0] + Math.sin(r) * v[1], -Math.sin(r) * v[0] + Math.cos(r) * v[1]];

// ---------- upstream GLSL vertex-shader.js ----------
function refVertex(c, ndc) {
  const uv = scale(ndc, 0.5);
  const boxOrigin = v2(0.5 - c.originX, c.originY - 0.5);
  const givenBoxSize = scale(v2(Math.max(c.worldWidth, 1), Math.max(c.worldHeight, 1)), c.pixelRatio);
  const r = (c.rotation * PI) / 180;
  const graphicOffset = v2(-c.offsetX, c.offsetY);
  const res = c.resolution;

  const getBoxSize = (boxRatio, given) => {
    let bx = boxRatio * Math.min(given[0] / boxRatio, given[1]);
    const noFit = bx;
    if (c.fit === 1) bx = boxRatio * Math.min(res[0] / boxRatio, res[1]);
    else if (c.fit === 2) bx = boxRatio * Math.max(res[0] / boxRatio, res[1]);
    return [bx, bx / boxRatio, noFit];
  };

  const fixedRatioBoxGivenSize = v2(c.worldWidth === 0 ? res[0] : givenBoxSize[0], c.worldHeight === 0 ? res[1] : givenBoxSize[1]);
  const objectBox = getBoxSize(1, fixedRatioBoxGivenSize);
  const objectBoxSize = [objectBox[0], objectBox[1]];
  const objectWorldScale = div(res, objectBoxSize);
  let objectUV = mul(uv, objectWorldScale);
  objectUV = add(objectUV, mul(boxOrigin, sub(objectWorldScale, [1, 1])));
  objectUV = add(objectUV, graphicOffset);
  objectUV = scale(objectUV, 1 / c.scale);
  objectUV = rot(objectUV, r);

  const patternBoxGivenSize = fixedRatioBoxGivenSize;
  const patternBoxRatio = patternBoxGivenSize[0] / patternBoxGivenSize[1];
  const boxData = getBoxSize(patternBoxRatio, patternBoxGivenSize);
  const patternBoxSize = [boxData[0], boxData[1]];
  const noFitWidth = boxData[2];
  const patternBoxScale = div(res, patternBoxSize);
  let patternUV = uv;
  patternUV = add(patternUV, div(graphicOffset, patternBoxScale));
  patternUV = add(patternUV, boxOrigin);
  patternUV = sub(patternUV, div(boxOrigin, patternBoxScale));
  patternUV = mul(patternUV, res);
  patternUV = scale(patternUV, 1 / c.pixelRatio);
  if (c.fit > 0) patternUV = scale(patternUV, noFitWidth / patternBoxSize[0]);
  patternUV = scale(patternUV, 1 / c.scale);
  patternUV = rot(patternUV, r);
  patternUV = add(patternUV, div(boxOrigin, patternBoxScale));
  patternUV = sub(patternUV, boxOrigin);
  patternUV = scale(patternUV, 0.01);

  return { objectUV, patternUV, objectBoxSize, patternBoxSize };
}

// ---------- WGSL port (wgsl-utils.ts sizedVertex) ----------
function portVertex(c, ndc) {
  const uv = scale(ndc, 0.5);
  const boxOrigin = v2(0.5 - c.originX, c.originY - 0.5);
  const givenBoxSize = scale(v2(Math.max(c.worldWidth, 1), Math.max(c.worldHeight, 1)), c.pixelRatio);
  const r = (c.rotation * PI) / 180;
  const graphicOffset = v2(-c.offsetX, c.offsetY);
  const res = c.resolution;

  const getBoxSize = (boxRatio, given) => {
    let boxWidth = boxRatio * Math.min(given[0] / boxRatio, given[1]);
    const noFitBoxWidth = boxWidth;
    if (c.fit === 1) boxWidth = boxRatio * Math.min(res[0] / boxRatio, res[1]);
    else if (c.fit === 2) boxWidth = boxRatio * Math.max(res[0] / boxRatio, res[1]);
    return [boxWidth, boxWidth / boxRatio, noFitBoxWidth];
  };

  const sizedBox = v2(c.worldWidth === 0 ? res[0] : givenBoxSize[0], c.worldHeight === 0 ? res[1] : givenBoxSize[1]);

  const objectBox = getBoxSize(1, sizedBox);
  const objectBoxSize = [objectBox[0], objectBox[1]];
  const objectWorldScale = div(res, objectBoxSize);
  let objectUV = mul(uv, objectWorldScale);
  objectUV = add(objectUV, mul(boxOrigin, sub(objectWorldScale, [1, 1])));
  objectUV = add(objectUV, graphicOffset);
  objectUV = scale(objectUV, 1 / c.scale);
  objectUV = rot(objectUV, r);

  const patternBoxRatio = sizedBox[0] / sizedBox[1];
  const patternBox = getBoxSize(patternBoxRatio, sizedBox);
  const patternBoxSize = [patternBox[0], patternBox[1]];
  const patternBoxScale = div(res, patternBoxSize);
  let patternUV = uv;
  patternUV = add(patternUV, div(graphicOffset, patternBoxScale));
  patternUV = add(patternUV, boxOrigin);
  patternUV = sub(patternUV, div(boxOrigin, patternBoxScale));
  patternUV = mul(patternUV, res);
  patternUV = scale(patternUV, 1 / c.pixelRatio);
  if (c.fit > 0) patternUV = scale(patternUV, patternBox[2] / patternBox[0]);
  patternUV = scale(patternUV, 1 / c.scale);
  patternUV = rot(patternUV, r);
  patternUV = add(patternUV, div(boxOrigin, patternBoxScale));
  patternUV = sub(patternUV, boxOrigin);
  patternUV = scale(patternUV, 0.01);

  return { objectUV, patternUV, objectBoxSize, patternBoxSize };
}

// ---------- upstream grain fragment pre-shape (05graingradient.ts) ----------
function refGrainPre(c, vary) {
  const r = (c.rotation * PI) / 180;
  const graphicOffset = v2(-c.offsetX, c.offsetY);
  const res = c.resolution;
  let shapeUV, grainUV;
  if (c.shape > 3.5) {
    shapeUV = vary.objectUV;
    grainUV = rotT(shapeUV, r);
    grainUV = scale(grainUV, c.scale);
    grainUV = sub(grainUV, graphicOffset);
    grainUV = mul(grainUV, vary.objectBoxSize);
    grainUV = scale(grainUV, 0.7);
  } else {
    shapeUV = scale(vary.patternUV, 0.5);
    grainUV = scale(vary.patternUV, 100);
    grainUV = rotT(grainUV, r);
    grainUV = scale(grainUV, c.scale);
    if (c.fit > 0) {
      const givenBoxSize = scale(v2(Math.max(c.worldWidth, 1), Math.max(c.worldHeight, 1)), c.pixelRatio);
      const boxGivenSize = v2(c.worldWidth === 0 ? res[0] : givenBoxSize[0], c.worldHeight === 0 ? res[1] : givenBoxSize[1]);
      const ratio = boxGivenSize[0] / boxGivenSize[1];
      const noFitBoxWidth = ratio * Math.min(boxGivenSize[0] / ratio, boxGivenSize[1]);
      grainUV = scale(grainUV, 1 / (noFitBoxWidth / vary.patternBoxSize[0]));
    }
    const patternBoxScale = div(res, vary.patternBoxSize);
    grainUV = sub(grainUV, div(graphicOffset, patternBoxScale));
    grainUV = scale(grainUV, 1.6);
  }
  return { shapeUV, grainUV };
}

// ---------- WGSL grain fragment pre-shape (grain-gradient.tsx fs_main) ----------
function portGrainPre(c, vary) {
  const radians = (c.rotation * PI) / 180;
  const graphicOffset = v2(-c.offsetX, c.offsetY);
  const res = c.resolution;
  let shapeUV, grainUV;
  if (c.shape > 3.5) {
    shapeUV = vary.objectUV;
    grainUV = rotT(shapeUV, radians);
    grainUV = scale(grainUV, c.scale);
    grainUV = sub(grainUV, graphicOffset);
    grainUV = mul(grainUV, vary.objectBoxSize);
    grainUV = scale(grainUV, 0.7);
  } else {
    shapeUV = scale(vary.patternUV, 0.5);
    grainUV = scale(vary.patternUV, 100);
    grainUV = rotT(grainUV, radians);
    grainUV = scale(grainUV, c.scale);
    if (c.fit > 0) {
      const givenBoxSize = scale(v2(Math.max(c.worldWidth, 1), Math.max(c.worldHeight, 1)), c.pixelRatio);
      const boxGivenSize = v2(c.worldWidth === 0 ? res[0] : givenBoxSize[0], c.worldHeight === 0 ? res[1] : givenBoxSize[1]);
      const ratio = boxGivenSize[0] / boxGivenSize[1];
      const noFitBoxWidth = ratio * Math.min(boxGivenSize[0] / ratio, boxGivenSize[1]);
      grainUV = scale(grainUV, 1 / (noFitBoxWidth / vary.patternBoxSize[0]));
    }
    const patternBoxScale = div(res, vary.patternBoxSize);
    grainUV = sub(grainUV, div(graphicOffset, patternBoxScale));
    grainUV = scale(grainUV, 1.6);
  }
  return { shapeUV, grainUV };
}

// ---------- upstream dithering fragment sizing (01dithering.ts) ----------
// fragCoordGL: gl_FragCoord.xy, bottom-up.
function refDither(c, fragCoordGL) {
  const res = c.resolution;
  const pxSize = c.pxSize * c.pixelRatio;
  let pxSizeUV = scale(sub(fragCoordGL, scale(res, 0.5)), 1 / pxSize);
  const canvasPixelizedUV = scale(add([Math.floor(pxSizeUV[0]), Math.floor(pxSizeUV[1])], [0.5, 0.5]), pxSize);
  const normalizedUV = div(canvasPixelizedUV, res);

  const ditheringNoiseUV = canvasPixelizedUV;
  let shapeUV = normalizedUV;

  const boxOrigin = v2(0.5 - c.originX, c.originY - 0.5);
  const givenBoxSize = scale(v2(Math.max(c.worldWidth, 1), Math.max(c.worldHeight, 1)), c.pixelRatio);
  const r = (c.rotation * PI) / 180;
  // upstream declares graphicOffset here too but writes vec2(-u_offsetX, u_offsetY) inline below

  const patternBoxRatio = givenBoxSize[0] / givenBoxSize[1];
  const boxSize = v2(c.worldWidth === 0 ? res[0] : givenBoxSize[0], c.worldHeight === 0 ? res[1] : givenBoxSize[1]);

  if (c.shape > 3.5) {
    let objectBoxX = Math.min(boxSize[0], boxSize[1]);
    if (c.fit === 1) objectBoxX = Math.min(res[0], res[1]);
    else if (c.fit === 2) objectBoxX = Math.max(res[0], res[1]);
    const objectWorldScale = div(res, [objectBoxX, objectBoxX]);
    shapeUV = mul(shapeUV, objectWorldScale);
    shapeUV = add(shapeUV, mul(boxOrigin, sub(objectWorldScale, [1, 1])));
    shapeUV = add(shapeUV, v2(-c.offsetX, c.offsetY));
    shapeUV = scale(shapeUV, 1 / c.scale);
    shapeUV = rot(shapeUV, r);
  } else {
    let patternBoxX = patternBoxRatio * Math.min(boxSize[0] / patternBoxRatio, boxSize[1]);
    const patternWorldNoFitBoxWidth = patternBoxX;
    if (c.fit === 1) patternBoxX = patternBoxRatio * Math.min(res[0] / patternBoxRatio, res[1]);
    else if (c.fit === 2) patternBoxX = patternBoxRatio * Math.max(res[0] / patternBoxRatio, res[1]);
    const patternBoxSize = [patternBoxX, patternBoxX / patternBoxRatio];
    const patternWorldScale = div(res, patternBoxSize);
    shapeUV = add(shapeUV, div(v2(-c.offsetX, c.offsetY), patternWorldScale));
    shapeUV = add(shapeUV, boxOrigin);
    shapeUV = sub(shapeUV, div(boxOrigin, patternWorldScale));
    shapeUV = mul(shapeUV, res);
    shapeUV = scale(shapeUV, 1 / c.pixelRatio);
    if (c.fit > 0) shapeUV = scale(shapeUV, patternWorldNoFitBoxWidth / patternBoxSize[0]);
    shapeUV = scale(shapeUV, 1 / c.scale);
    shapeUV = rot(shapeUV, r);
    shapeUV = add(shapeUV, div(boxOrigin, patternWorldScale));
    shapeUV = sub(shapeUV, boxOrigin);
    shapeUV = add(shapeUV, [0.5, 0.5]);
  }
  return { pxSizeUV, ditheringNoiseUV, shapeUV };
}

// ---------- WGSL dithering port (dithering.tsx fs_main), given builtin position (top-down) ----------
function portDither(c, position) {
  const res = c.resolution;
  const fragCoord = v2(position[0], res[1] - position[1]);
  const pxSize = c.pxSize * c.pixelRatio;
  const pxSizeUV = scale(sub(fragCoord, scale(res, 0.5)), 1 / pxSize);
  const canvasPixelizedUV = scale(add([Math.floor(pxSizeUV[0]), Math.floor(pxSizeUV[1])], [0.5, 0.5]), pxSize);
  const normalizedUV = div(canvasPixelizedUV, res);

  const ditheringNoiseUV = canvasPixelizedUV;
  let shapeUV = normalizedUV;

  const boxOrigin = v2(0.5 - c.originX, c.originY - 0.5);
  const givenBoxSize = scale(v2(Math.max(c.worldWidth, 1), Math.max(c.worldHeight, 1)), c.pixelRatio);
  const r = (c.rotation * PI) / 180;
  const graphicOffset = v2(-c.offsetX, c.offsetY);

  const boxSize = v2(c.worldWidth === 0 ? res[0] : givenBoxSize[0], c.worldHeight === 0 ? res[1] : givenBoxSize[1]);

  if (c.shape > 3.5) {
    let objectBoxWidth = Math.min(boxSize[0], boxSize[1]);
    if (c.fit === 1) objectBoxWidth = Math.min(res[0], res[1]);
    else if (c.fit === 2) objectBoxWidth = Math.max(res[0], res[1]);
    const objectWorldScale = div(res, [objectBoxWidth, objectBoxWidth]);
    shapeUV = mul(shapeUV, objectWorldScale);
    shapeUV = add(shapeUV, mul(boxOrigin, sub(objectWorldScale, [1, 1])));
    shapeUV = add(shapeUV, graphicOffset);
    shapeUV = scale(shapeUV, 1 / c.scale);
    shapeUV = rot(shapeUV, r);
  } else {
    const patternBoxRatio = givenBoxSize[0] / givenBoxSize[1];
    let patternBoxWidth = patternBoxRatio * Math.min(boxSize[0] / patternBoxRatio, boxSize[1]);
    const patternWorldNoFitBoxWidth = patternBoxWidth;
    if (c.fit === 1) patternBoxWidth = patternBoxRatio * Math.min(res[0] / patternBoxRatio, res[1]);
    else if (c.fit === 2) patternBoxWidth = patternBoxRatio * Math.max(res[0] / patternBoxRatio, res[1]);
    const patternBoxSize = [patternBoxWidth, patternBoxWidth / patternBoxRatio];
    const patternWorldScale = div(res, patternBoxSize);
    shapeUV = add(shapeUV, div(graphicOffset, patternWorldScale));
    shapeUV = add(shapeUV, boxOrigin);
    shapeUV = sub(shapeUV, div(boxOrigin, patternWorldScale));
    shapeUV = mul(shapeUV, res);
    shapeUV = scale(shapeUV, 1 / c.pixelRatio);
    if (c.fit > 0) shapeUV = scale(shapeUV, patternWorldNoFitBoxWidth / patternBoxSize[0]);
    shapeUV = scale(shapeUV, 1 / c.scale);
    shapeUV = rot(shapeUV, r);
    shapeUV = add(shapeUV, div(boxOrigin, patternWorldScale));
    shapeUV = sub(shapeUV, boxOrigin);
    shapeUV = add(shapeUV, [0.5, 0.5]);
  }
  return { pxSizeUV, ditheringNoiseUV, shapeUV };
}

// ---------- fuzz ----------
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let failures = 0;
const close = (a, b, label, cfg) => {
  const flat = (x) => (Array.isArray(x) ? x : [x]);
  const fa = flat(a);
  const fb = flat(b);
  for (let i = 0; i < fa.length; i++) {
    const diff = Math.abs(fa[i] - fb[i]);
    const tol = 1e-9 * Math.max(1, Math.abs(fa[i]), Math.abs(fb[i]));
    if (!(diff <= tol)) {
      if (failures < 10) console.log(`MISMATCH ${label}[${i}]: ref=${fa[i]} port=${fb[i]}`, JSON.stringify(cfg));
      failures++;
      return;
    }
  }
};

for (let trial = 0; trial < 2000; trial++) {
  const cfg = {
    resolution: [Math.round(rand(64, 3000)), Math.round(rand(64, 3000))],
    pixelRatio: pick([1, 1.25, 1.5, 2, rand(0.5, 3)]),
    fit: pick([0, 1, 2]),
    scale: rand(0.01, 4),
    rotation: rand(0, 360),
    offsetX: rand(-1, 1),
    offsetY: rand(-1, 1),
    originX: rand(0, 1),
    originY: rand(0, 1),
    worldWidth: pick([0, Math.round(rand(1, 4000))]),
    worldHeight: pick([0, Math.round(rand(1, 4000))]),
    shape: pick([1, 2, 3, 4, 5, 6, 7]),
    pxSize: rand(0.5, 20),
  };
  const ndc = [rand(-1, 1), rand(-1, 1)];

  const ref = refVertex(cfg, ndc);
  const port = portVertex(cfg, ndc);
  close(ref.objectUV, port.objectUV, 'objectUV', cfg);
  close(ref.patternUV, port.patternUV, 'patternUV', cfg);
  close(ref.objectBoxSize, port.objectBoxSize, 'objectBoxSize', cfg);
  close(ref.patternBoxSize, port.patternBoxSize, 'patternBoxSize', cfg);

  const refPre = refGrainPre(cfg, ref);
  const portPre = portGrainPre(cfg, port);
  close(refPre.shapeUV, portPre.shapeUV, 'grain shapeUV', cfg);
  close(refPre.grainUV, portPre.grainUV, 'grain grainUV', cfg);

  // Same physical pixel expressed in each API's fragment coordinates.
  const px = Math.floor(rand(0, cfg.resolution[0]));
  const py = Math.floor(rand(0, cfg.resolution[1])); // top-down row index
  const fragCoordGL = [px + 0.5, cfg.resolution[1] - py - 0.5];
  const positionWebGPU = [px + 0.5, py + 0.5];
  const refD = refDither(cfg, fragCoordGL);
  const portD = portDither(cfg, positionWebGPU);
  close(refD.pxSizeUV, portD.pxSizeUV, 'dither pxSizeUV', cfg);
  close(refD.ditheringNoiseUV, portD.ditheringNoiseUV, 'dither noiseUV', cfg);
  close(refD.shapeUV, portD.shapeUV, 'dither shapeUV', cfg);
}

console.log(failures === 0 ? 'ALL PASS (2000 randomized configs)' : `${failures} FAILURES`);
