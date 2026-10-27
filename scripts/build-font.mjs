// Converts the bundled Fredoka Bold (SIL OFL 1.1) WOFF into a compact three.js
// typeface JSON containing only the glyphs the game renders in 3D.
// Usage: npm run font
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const opentype = require('opentype.js');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = path.join(root, 'node_modules/@fontsource/fredoka/files/fredoka-latin-700-normal.woff');
const out = path.join(root, 'src/assets/fredoka-bold.typeface.json');

const CHARS = '0123456789,.+-−×÷=!?:ABCDEFGHIJKLMNOPQRSTUVWXYZ ';

const buf = fs.readFileSync(src);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const scale = 100000 / ((font.unitsPerEm || 2048) * 72);
const r = (v) => Math.round(v * scale);

const glyphs = {};
for (const ch of CHARS) {
  const g = font.charToGlyph(ch);
  const token = { ha: r(g.advanceWidth), x_min: r(g.xMin ?? 0), x_max: r(g.xMax ?? 0), o: '' };
  for (const c of g.path.commands) {
    // three.js typeface format lists the end point before control points.
    if (c.type === 'M') token.o += `m ${r(c.x)} ${r(c.y)} `;
    else if (c.type === 'L') token.o += `l ${r(c.x)} ${r(c.y)} `;
    else if (c.type === 'Q') token.o += `q ${r(c.x)} ${r(c.y)} ${r(c.x1)} ${r(c.y1)} `;
    else if (c.type === 'C') token.o += `b ${r(c.x)} ${r(c.y)} ${r(c.x1)} ${r(c.y1)} ${r(c.x2)} ${r(c.y2)} `;
  }
  token.o = token.o.trim();
  glyphs[ch] = token;
}

const json = {
  glyphs,
  familyName: 'Fredoka',
  ascender: r(font.ascender),
  descender: r(font.descender),
  underlinePosition: r(font.tables.post.underlinePosition),
  underlineThickness: r(font.tables.post.underlineThickness),
  boundingBox: {
    xMin: r(font.tables.head.xMin),
    xMax: r(font.tables.head.xMax),
    yMin: r(font.tables.head.yMin),
    yMax: r(font.tables.head.yMax),
  },
  resolution: 1000,
  original_font_information: { license: 'SIL Open Font License 1.1', source: 'Fredoka (https://github.com/hafontia/Fredoka-One) via @fontsource/fredoka' },
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(json));
console.log(`Wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} KB, ${Object.keys(glyphs).length} glyphs)`);
