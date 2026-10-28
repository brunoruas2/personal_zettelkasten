import { describe, expect, it } from 'vitest';
import { BACK_STACK_MAX, BackStack } from './BackStack';

const e = (id: string | null, cam = 0) => ({ id, camera: cam });

describe('BackStack', () => {
  it('empilha e desempilha na ordem inversa', () => {
    const s = new BackStack<number>();
    s.push(e('A'));
    s.push(e('B'));
    expect(s.pop()?.id).toBe('B');
    expect(s.pop()?.id).toBe('A');
    expect(s.pop()).toBeUndefined();
  });

  it('saltar do mesmo zettel do topo só atualiza a câmera', () => {
    const s = new BackStack<number>();
    s.push(e('A', 1));
    s.push(e('A', 2));
    expect(s.size).toBe(1);
    expect(s.peek()?.camera).toBe(2);
  });

  it('respeita o teto de 50 descartando a mais antiga', () => {
    const s = new BackStack<number>();
    for (let i = 0; i < BACK_STACK_MAX + 1; i++) s.push(e(`Z${i}`));
    expect(s.size).toBe(BACK_STACK_MAX);
    s.popUntil((x) => x.id === 'Z1');
    expect(s.size).toBe(0);
  });

  it('popUntil descarta as entradas de cima', () => {
    const s = new BackStack<number>();
    s.push(e('A'));
    s.push(e(null));
    s.push(e('B'));
    expect(s.popUntil((x) => x.id === 'A')?.id).toBe('A');
    expect(s.size).toBe(0);
  });
});

describe('BackStack — avançar', () => {
  it('Voltar empilha o atual no avançar e Avançar o devolve', () => {
    const s = new BackStack<number>();
    s.push(e('A'));
    // Voltar de B para A: o estado atual (B) vai para o avançar.
    const back = s.pop()!;
    s.pushForward(e('B'));
    expect(back.id).toBe('A');
    expect(s.forwardSize).toBe(1);
    // Avançar: devolve B e põe o estado atual (A) de volta no Voltar.
    const fwd = s.popForward()!;
    s.pushFromForward(e('A'));
    expect(fwd.id).toBe('B');
    expect(s.peek()?.id).toBe('A');
    expect(s.forwardSize).toBe(0);
  });

  it('um salto novo limpa o avançar', () => {
    const s = new BackStack<number>();
    s.pushForward(e('B'));
    s.pushForward(e('C'));
    s.push(e('D'));
    expect(s.forwardSize).toBe(0);
    expect(s.popForward()).toBeUndefined();
  });

  it('Avançar não limpa o resto do avançar', () => {
    const s = new BackStack<number>();
    s.pushForward(e('C'));
    s.pushForward(e('B'));
    s.popForward();
    s.pushFromForward(e('A'));
    expect(s.peekForward()?.id).toBe('C');
  });

  it('o avançar tem o mesmo teto', () => {
    const s = new BackStack<number>();
    for (let i = 0; i < BACK_STACK_MAX + 5; i++) s.pushForward(e(`F${i}`));
    expect(s.forwardSize).toBe(BACK_STACK_MAX);
    expect(s.peekForward()?.id).toBe(`F${BACK_STACK_MAX + 4}`);
  });
});

describe('BackStack — trilha', () => {
  const stack = () => {
    const s = new BackStack<number>();
    for (const id of ['A', 'B', 'C', 'D']) s.push(e(id));
    return s;
  };

  it('recent devolve as últimas n, da mais antiga à mais nova', () => {
    expect(stack().recent(3).map((x) => x.id)).toEqual(['B', 'C', 'D']);
    expect(stack().recent(10).map((x) => x.id)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('popBack volta até uma parada e devolve as puladas', () => {
    const s = stack();
    const r = s.popBack(2)!; // topo = D (0), C (1), B (2)
    expect(r.reached.id).toBe('B');
    expect(r.skipped.map((x) => x.id)).toEqual(['C', 'D']);
    expect(s.size).toBe(1);
    expect(s.peek()?.id).toBe('A');
  });

  it('popBack(0) equivale a um Voltar', () => {
    const s = stack();
    const r = s.popBack(0)!;
    expect(r.reached.id).toBe('D');
    expect(r.skipped).toEqual([]);
  });

  it('popBack fora do alcance não altera a pilha', () => {
    const s = stack();
    expect(s.popBack(9)).toBeUndefined();
    expect(s.size).toBe(4);
  });
});
