import { describe, expect, it } from 'vitest';
import { rewriteLinkTitle } from './LinkParser';

describe('rewriteLinkTitle', () => {
  it('reescreve link comum', () => {
    expect(rewriteLinkTitle('veja [[Velho]] aqui', 'Velho', 'Novo')).toBe('veja [[Novo]] aqui');
  });

  it('preserva o ^ de parent-ref e o rótulo', () => {
    expect(rewriteLinkTitle('[[^Velho]] e [[Velho|texto]]', 'Velho', 'Novo')).toBe(
      '[[^Novo]] e [[Novo|texto]]',
    );
  });

  it('ignora caixa ao casar e não toca em outros títulos', () => {
    expect(rewriteLinkTitle('[[velho]] [[Velhote]]', 'Velho', 'Novo')).toBe('[[Novo]] [[Velhote]]');
  });

  it('trata metacaracteres de regex no título antigo', () => {
    expect(rewriteLinkTitle('[[C++ (v2)]]', 'C++ (v2)', 'Rust')).toBe('[[Rust]]');
  });
});
