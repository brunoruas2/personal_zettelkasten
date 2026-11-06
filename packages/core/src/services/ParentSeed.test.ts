import { describe, expect, it } from 'vitest';
import { seedBodyWithParent } from './ParentSeed';

describe('seedBodyWithParent', () => {
  it('semeia o link de pai na primeira linha', () => {
    expect(seedBodyWithParent('Projeto A')).toBe('[[^Projeto A]]\n\n');
  });

  it('apara espaços do título', () => {
    expect(seedBodyWithParent('  Projeto A  ')).toBe('[[^Projeto A]]\n\n');
  });

  it('devolve vazio sem título', () => {
    expect(seedBodyWithParent('')).toBe('');
    expect(seedBodyWithParent('   ')).toBe('');
    expect(seedBodyWithParent(undefined)).toBe('');
    expect(seedBodyWithParent(null)).toBe('');
  });

  it('devolve vazio com caractere reservado', () => {
    expect(seedBodyWithParent('a|b')).toBe('');
    expect(seedBodyWithParent('a [x]')).toBe('');
  });
});
