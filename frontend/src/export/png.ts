/**
 * PNG metadata: the resolution chunk. A canvas writes a PNG that says nothing about its size on
 * paper; `setPngDpi` adds the pHYs chunk (pixels per metre) so that editors and word processors
 * place the image at the intended physical size. Pure byte handling, no DOM.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const METRES_PER_INCH = 0.0254;

function isPng(b: Uint8Array): boolean {
  return b.length >= 8 && SIGNATURE.every((x, i) => b[i] === x);
}

const u32 = (b: Uint8Array, o: number): number =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function chunkType(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
}

/** A copy of the PNG with its resolution set to `dpi` (any pHYs chunk it had is replaced). */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(png)) throw new Error('Not a PNG file.');
  if (!(dpi > 0) || !Number.isFinite(dpi)) throw new RangeError('The DPI must be positive.');
  const ppm = Math.round(dpi / METRES_PER_INCH);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1; // metres
  view.setUint32(17, crc32(chunk.subarray(4, 17)));

  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let o = 8;
  while (o + 12 <= png.length) {
    const len = u32(png, o);
    const end = o + 12 + len;
    const type = chunkType(png, o);
    if (type !== 'pHYs') parts.push(png.subarray(o, end));
    // the resolution goes straight after the header
    if (type === 'IHDR') parts.push(chunk);
    o = end;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The resolution a PNG states, in dots per inch, or null when it has no pHYs chunk in metres. */
export function readPngDpi(png: Uint8Array): number | null {
  if (!isPng(png)) return null;
  let o = 8;
  while (o + 12 <= png.length) {
    const len = u32(png, o);
    if (chunkType(png, o) === 'pHYs' && len === 9 && png[o + 16] === 1)
      return u32(png, o + 8) * METRES_PER_INCH;
    o += 12 + len;
  }
  return null;
}
