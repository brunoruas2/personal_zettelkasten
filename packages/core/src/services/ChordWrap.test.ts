import { describe, expect, it } from 'vitest';
import { segmentChordPair } from './ChordWrap';

describe('segmentChordPair', () => {
  it('põe cada acorde sobre a palavra em que começa', () => {
    expect(segmentChordPair('C         G', 'Quando eu te vi')).toEqual([
      { chord: 'C', text: 'Quando ' },
      { chord: '', text: 'eu ' },
      { chord: 'G', text: 'te ' },
      { chord: '', text: 'vi' },
    ]);
  });

  it('corta a palavra quando o acorde cai no meio dela', () => {
    expect(segmentChordPair('   Am', 'Amanhã')).toEqual([
      { chord: '', text: 'Ama' },
      { chord: 'Am', text: 'nhã' },
    ]);
  });

  it('acordes além do fim da letra viram segmentos sem texto', () => {
    expect(segmentChordPair('C     G   D', 'Sol')).toEqual([
      { chord: 'C', text: 'Sol' },
      { chord: 'G', text: '' },
      { chord: 'D', text: '' },
    ]);
  });

  it('letra antes do primeiro acorde fica sem acorde', () => {
    expect(segmentChordPair('    D', 'Oh  meu')).toEqual([
      { chord: '', text: 'Oh  ' },
      { chord: 'D', text: 'meu' },
    ]);
  });

  it('ignora o marcador %c na contagem de colunas', () => {
    expect(segmentChordPair('%c Em   C', 'Nada como')).toEqual([
      { chord: 'Em', text: 'Nada ' },
      { chord: 'C', text: 'como' },
    ]);
  });

  it('preserva a letra inteira ao juntar os segmentos', () => {
    const lyric = '  Vem   ver o  mar azul';
    const text = segmentChordPair('  A  E    F#m   D', lyric).map((s) => s.text).join('');
    expect(text).toBe(lyric);
  });
});
