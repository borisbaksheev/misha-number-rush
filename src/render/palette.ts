import { Color } from 'three';
import type { OpKind } from '../math/numberMath';

/** One distinctive candy colour per digit (original palette). */
export const DIGIT_COLORS: Record<string, string> = {
  '0': '#f4f2ff',
  '1': '#0fbfae',
  '2': '#ff7a1f',
  '3': '#2f8fff',
  '4': '#6cc72b',
  '5': '#ff3d8b',
  '6': '#7b4dff',
  '7': '#ffbf1f',
  '8': '#ff3f4a',
  '9': '#b56dff',
  ',': '#ffffff',
};

export const OP_COLORS: Record<OpKind | 'join' | 'finale', string> = {
  add: '#2fd98a',
  sub: '#ff8f3a',
  mul: '#a35cff',
  div: '#22c7ee',
  join: '#ff5fb0',
  finale: '#ffc531',
};

export const SKY = {
  top: new Color('#3a9cf5'),
  mid: new Color('#9fd6ff'),
  horizon: new Color('#ffe2f0'),
  fog: new Color('#cfe6ff'),
};

export const ROAD = {
  surface: '#5850d8',
  surfaceDark: '#4740bb',
  line: '#ffffff',
  side: '#ffffff',
  under: '#7c74e8',
  curbA: '#ff5fa2',
  curbB: '#ffffff',
};

export const INK = '#2c1840';
