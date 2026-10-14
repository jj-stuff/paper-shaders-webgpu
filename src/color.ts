export function clamp(value: number, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

// Mirrors Paper's supported #hex, rgb(a), and hsl(a) formats without importing
// its WebGL renderer or relying on a browser-specific canvas color parser.
export function shaderColor(value: string): [number, number, number, number] {
  const source = value.trim();
  if (source.startsWith('#')) {
    let hex = source.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((part) => part + part).join('');
    if (hex.length === 6) hex += 'ff';
    if (/^[0-9a-f]{8}$/i.test(hex)) {
      return [0, 2, 4, 6].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255) as [number, number, number, number];
    }
  }

  const rgb = source.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgb) return [clamp(Number(rgb[1]) / 255), clamp(Number(rgb[2]) / 255), clamp(Number(rgb[3]) / 255), clamp(Number(rgb[4] ?? 1))];

  const hsl = source.match(/^hsla?\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (hsl) {
    const hue = (Number(hsl[1]) % 360) / 360;
    const saturation = clamp(Number(hsl[2]) / 100);
    const lightness = clamp(Number(hsl[3]) / 100);
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const segment = hue * 6;
    const x = chroma * (1 - Math.abs((segment % 2) - 1));
    const [r, g, b] = segment < 1 ? [chroma, x, 0] : segment < 2 ? [x, chroma, 0] : segment < 3 ? [0, chroma, x] : segment < 4 ? [0, x, chroma] : segment < 5 ? [x, 0, chroma] : [chroma, 0, x];
    const match = lightness - chroma / 2;
    return [r + match, g + match, b + match, clamp(Number(hsl[4] ?? 1))];
  }
  return [0, 0, 0, 1];
}
