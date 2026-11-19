import { describe, expect, it } from 'vitest';
import {
  assignmentToServer,
  liveTypes,
  serverAssignmentToRecord,
  serverTypeToType,
  typeToServer,
  type ServerType,
} from './ZettelType';

const wire: ServerType = {
  id: 't1',
  name: 'Conteúdo',
  slug: 'conteudo',
  icon: '📘',
  color: '#a78bfa',
  template: '## Captura\n',
  protected_sections: ['Minha síntese'],
  levels: [
    { key: 'semente', label: 'Semente', emoji: '🤖', user_only: false },
    { key: 'consolidado', label: 'Consolidado', user_only: true },
  ],
  counts_progress: true,
  updated_at: 10,
};

describe('conversão servidor ⇄ cliente', () => {
  it('ida e volta preserva o tipo', () => {
    expect(typeToServer(serverTypeToType(wire))).toEqual(wire);
  });
  it('níveis ganham userOnly e emoji opcional', () => {
    const t = serverTypeToType(wire);
    expect(t.levels[0]).toEqual({ key: 'semente', label: 'Semente', emoji: '🤖', userOnly: false });
    expect(t.levels[1].userOnly).toBe(true);
    expect('emoji' in t.levels[1]).toBe(false);
  });
  it('campos ausentes viram padrões seguros', () => {
    const t = serverTypeToType({ ...wire, template: undefined as unknown as string, protected_sections: undefined as unknown as string[], levels: undefined as unknown as ServerType['levels'] });
    expect(t.template).toBe('');
    expect(t.protectedSections).toEqual([]);
    expect(t.levels).toEqual([]);
  });
  it('atribuição: nível vazio vira null e volta como vazio', () => {
    const r = serverAssignmentToRecord({ zettel_id: 'z1', type_id: 't1', level: '', updated_at: 5 });
    expect(r).toMatchObject({ id: 'z1', typeId: 't1', level: null, deletedAt: null, syncState: 'synced' });
    expect(assignmentToServer(r)).toEqual({ zettel_id: 'z1', type_id: 't1', level: '', updated_at: 5 });
  });
  it('tombstone de atribuição leva deleted_at', () => {
    const r = serverAssignmentToRecord({ zettel_id: 'z1', type_id: 't1', level: '', updated_at: 5, deleted_at: 9 });
    expect(r.deletedAt).toBe(9);
    expect(assignmentToServer(r).deleted_at).toBe(9);
  });
});

describe('liveTypes', () => {
  it('tira os apagados e ordena por nome', () => {
    const list = [
      { name: 'Teste', deletedAt: null },
      { name: 'Apagado', deletedAt: 5 },
      { name: 'ação', deletedAt: null },
    ];
    expect(liveTypes(list).map((t) => t.name)).toEqual(['ação', 'Teste']);
  });
});
