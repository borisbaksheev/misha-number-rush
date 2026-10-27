// Extruded, rounded 3D glyphs built from the bundled Fredoka Bold outline font.
import { BufferGeometry, ExtrudeGeometry } from 'three';
import { Font, type FontData } from 'three/examples/jsm/loaders/FontLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import fontJson from '../assets/fredoka-bold.typeface.json';

export const font = new Font(fontJson as unknown as FontData);

export interface Glyph {
  geometry: BufferGeometry;
  /** Width of the glyph's visible outline. */
  width: number;
  /** Height of the glyph's visible outline. */
  height: number;
  /** Z of the front face (geometry is centred in depth). */
  front: number;
}

export interface GlyphStyle {
  depth: number;
  bevel: number;
  curveSegments: number;
  bevelSegments: number;
}

export const CHARACTER_STYLE: GlyphStyle = { depth: 0.3, bevel: 0.065, curveSegments: 10, bevelSegments: 4 };
export const SIGN_STYLE: GlyphStyle = { depth: 0.22, bevel: 0.05, curveSegments: 6, bevelSegments: 2 };

// Fredoka digit height is ~0.7 em; normalise so digits are 1 unit tall.
const DIGIT_EM = (() => {
  const shapes = font.generateShapes('0', 1);
  const g = new ExtrudeGeometry(shapes, { depth: 0.01, bevelEnabled: false });
  g.computeBoundingBox();
  const h = g.boundingBox!.max.y - g.boundingBox!.min.y;
  g.dispose();
  return 1 / h;
})();

const cache = new Map<string, Glyph>();

/** A glyph whose digit-height is 1 with the baseline at y = 0, horizontally centred. */
export function glyph(ch: string, style: GlyphStyle = CHARACTER_STYLE): Glyph {
  const key = `${ch}|${style.depth}|${style.bevel}|${style.curveSegments}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const shapes = font.generateShapes(ch, DIGIT_EM);
  let geo: BufferGeometry = new ExtrudeGeometry(shapes, {
    depth: style.depth,
    bevelEnabled: true,
    bevelThickness: style.bevel,
    bevelSize: style.bevel * 0.7,
    bevelOffset: -style.bevel * 0.35,
    bevelSegments: style.bevelSegments,
    curveSegments: style.curveSegments,
  });
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo, 1e-4);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const cx = (bb.min.x + bb.max.x) / 2;
  geo.translate(-cx, 0, -style.depth / 2);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const g: Glyph = {
    geometry: geo,
    width: bb.max.x - bb.min.x,
    height: bb.max.y - bb.min.y,
    front: style.depth / 2 + style.bevel,
  };
  cache.set(key, g);
  return g;
}

/** Lay out a string of glyphs centred on x = 0. Returns per-char offsets and the total width. */
export function layoutText(text: string, style: GlyphStyle = CHARACTER_STYLE, gap = 0.07) {
  const items: { ch: string; glyph: Glyph; x: number }[] = [];
  let x = 0;
  for (const ch of text) {
    if (ch === ' ') {
      x += 0.35;
      continue;
    }
    const g = glyph(ch, style);
    const w = ch === ',' ? g.width + 0.02 : g.width;
    items.push({ ch, glyph: g, x: x + w / 2 });
    x += w + gap;
  }
  const width = Math.max(0, x - gap);
  for (const it of items) it.x -= width / 2;
  return { items, width };
}
