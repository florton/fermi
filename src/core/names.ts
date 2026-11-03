/** Procedural lineage names, so the chronicle reads as history rather than as indices. */

const ONSETS = ['', 'k', 'v', 'th', 'zh', 'r', 's', 'n', 'm', 'q', 'x', 'l', 'dr', 'sk', 'h', 'y', 'tl'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ae', 'ou', 'y', 'ai'];
const CODAS = ['', '', 'n', 'r', 'th', 'x', 'l', 's', 'k', 'sh'];

export function lineageName(id: number): string {
  let h = (id + 1) * 2654435761;
  const next = (m: number) => {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    return h % m;
  };
  const syll = 2 + next(2);
  let s = '';
  for (let i = 0; i < syll; i++) s += ONSETS[next(ONSETS.length)] + VOWELS[next(VOWELS.length)] + (i === syll - 1 ? CODAS[next(CODAS.length)] : '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
