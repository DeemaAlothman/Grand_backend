/**
 * Generates a solid-color placeholder PNG with a big two-digit number drawn in a
 * seven-segment display style — no external image libraries, no fonts, no network. Built
 * from raw RGB pixels + Node's built-in zlib (a real PNG a browser can render), since there's
 * no source of real product photography available for demo seeding.
 */
import { deflateSync } from 'zlib';

type RGB = [number, number, number];

const SEGMENT_MAP: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcfgd',
};
// a=top b=top-right c=bottom-right d=bottom e=bottom-left f=top-left g=middle

function crc32(buf: Buffer): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  // Each scanline needs a filter-type byte (0 = none) prepended.
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    rgb.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3);
  }
  const idatData = deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdrData),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

class Canvas {
  readonly buf: Buffer;
  constructor(
    readonly width: number,
    readonly height: number,
    background: RGB,
  ) {
    this.buf = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      this.buf[i * 3] = background[0];
      this.buf[i * 3 + 1] = background[1];
      this.buf[i * 3 + 2] = background[2];
    }
  }

  fillRect(x: number, y: number, w: number, h: number, color: RGB) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * this.width + xx) * 3;
        this.buf[i] = color[0];
        this.buf[i + 1] = color[1];
        this.buf[i + 2] = color[2];
      }
    }
  }

  toPng(): Buffer {
    return encodePng(this.width, this.height, this.buf);
  }
}

/** Draws one seven-segment digit into the canvas at (x, y), sized digitW x digitH. */
function drawDigit(
  canvas: Canvas,
  digit: string,
  x: number,
  y: number,
  digitW: number,
  digitH: number,
  color: RGB,
) {
  const segs = SEGMENT_MAP[digit] ?? '';
  const thickness = Math.round(digitW * 0.22);
  const half = Math.round(digitH / 2);
  if (segs.includes('a')) canvas.fillRect(x, y, digitW, thickness, color);
  if (segs.includes('g'))
    canvas.fillRect(x, y + half - Math.round(thickness / 2), digitW, thickness, color);
  if (segs.includes('d'))
    canvas.fillRect(x, y + digitH - thickness, digitW, thickness, color);
  if (segs.includes('f')) canvas.fillRect(x, y, thickness, half, color);
  if (segs.includes('e')) canvas.fillRect(x, y + half, thickness, half, color);
  if (segs.includes('b')) canvas.fillRect(x + digitW - thickness, y, thickness, half, color);
  if (segs.includes('c'))
    canvas.fillRect(x + digitW - thickness, y + half, thickness, half, color);
}

export interface PlaceholderImageOptions {
  width?: number;
  height?: number;
  background: RGB;
  panel: RGB;
  digitColor: RGB;
  number: number; // 0-99, rendered as two digits
}

export function generatePlaceholderImage(opts: PlaceholderImageOptions): Buffer {
  const width = opts.width ?? 480;
  const height = opts.height ?? 360;
  const canvas = new Canvas(width, height, opts.background);

  // A centered panel gives the flat background some depth without needing real artwork.
  const panelMargin = Math.round(width * 0.12);
  canvas.fillRect(
    panelMargin,
    panelMargin,
    width - panelMargin * 2,
    height - panelMargin * 2,
    opts.panel,
  );

  const digits = String(Math.max(0, Math.min(99, opts.number))).padStart(2, '0');
  const digitH = Math.round(height * 0.32);
  const digitW = Math.round(digitH * 0.55);
  const gap = Math.round(digitW * 0.3);
  const totalW = digitW * 2 + gap;
  const startX = Math.round((width - totalW) / 2);
  const startY = Math.round((height - digitH) / 2);
  drawDigit(canvas, digits[0], startX, startY, digitW, digitH, opts.digitColor);
  drawDigit(
    canvas,
    digits[1],
    startX + digitW + gap,
    startY,
    digitW,
    digitH,
    opts.digitColor,
  );

  // Thin top accent strip in the digit color, ties the panel and the "brand" color together.
  canvas.fillRect(0, 0, width, Math.round(height * 0.03), opts.digitColor);

  return canvas.toPng();
}
