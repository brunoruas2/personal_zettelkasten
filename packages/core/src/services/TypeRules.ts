import type { TypeLevel, ZettelType } from '../models/ZettelType';

/** Origem de uma escrita: `agent` = chave `zk_`/MCP, `ui` = o usuário logado. */
export type WriteSource = 'agent' | 'ui';

export function findLevel(type: Pick<ZettelType, 'levels'>, key: string | null | undefined): TypeLevel | undefined {
  if (!key) return undefined;
  return type.levels.find((l) => l.key === key);
}

/**
 * Nível efetivo: a `key` guardada só vale se o tipo ainda a declara. Nível
 * removido do tipo vira "sem nível" sem apagar a atribuição.
 */
export function effectiveLevel(type: Pick<ZettelType, 'levels'> | undefined, key: string | null | undefined): string | null {
  if (!type || !key) return null;
  return findLevel(type, key) ? key : null;
}

/** Nível aceito pelo tipo: tipo sem escada só aceita vazio; senão, uma `key` declarada. */
export function validateLevel(type: Pick<ZettelType, 'levels'>, level: string | null | undefined): string | null {
  if (!level) return null;
  if (type.levels.length === 0) return 'este tipo não tem níveis';
  if (!findLevel(type, level)) {
    return `nível "${level}" inexistente; use um de: ${type.levels.map((l) => l.key).join(', ')}`;
  }
  return null;
}

/**
 * Nível depois de trocar o tipo: limpa, a menos que o pedido traga um nível
 * válido do tipo novo.
 */
export function levelAfterTypeChange(next: Pick<ZettelType, 'levels'>, requested: string | null | undefined): string | null {
  return requested && findLevel(next, requested) ? requested : null;
}

export interface LevelChangeCheck {
  ok: boolean;
  reason?: string;
}

/**
 * A origem `agent` não pode atribuir um nível `user_only` nem tirar um zettel
 * de um nível `user_only` (trocar de nível, de tipo ou remover o tipo). A
 * origem `ui` pode tudo.
 */
export interface LevelState {
  /** `null` = sem tipo. */
  type: Pick<ZettelType, 'id' | 'levels'> | null;
  level: string | null;
}

export function checkLevelChange(source: WriteSource, from: LevelState, to: LevelState): LevelChangeCheck {
  if (source === 'ui') return { ok: true };
  const unchanged = (from.type?.id ?? null) === (to.type?.id ?? null) && (from.level ?? null) === (to.level ?? null);
  if (unchanged) return { ok: true };
  if (from.type && findLevel(from.type, from.level)?.userOnly) {
    return { ok: false, reason: 'o zettel está num nível reservado ao usuário; só o usuário pode mudá-lo' };
  }
  if (to.type && findLevel(to.type, to.level)?.userOnly) {
    return { ok: false, reason: 'esse nível é reservado ao usuário; só ele pode marcá-lo' };
  }
  return { ok: true };
}
