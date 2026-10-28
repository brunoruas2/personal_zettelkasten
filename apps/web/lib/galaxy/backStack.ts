import { BackStack as CoreBackStack, BACK_STACK_MAX, type BackEntry as CoreBackEntry } from '@zettelkasten/core';
import type { Camera } from './camera';

export { BACK_STACK_MAX };

/** De onde o usuário saltou: o zettel atual (se havia) e a câmera do momento. */
export type BackEntry = CoreBackEntry<Camera>;

/**
 * Pilha de saltos entre zettels (Voltar e Avançar), com a câmera da galáxia.
 * A lógica pura mora em `@zettelkasten/core` (testada com Vitest).
 */
export class BackStack extends CoreBackStack<Camera> {}
