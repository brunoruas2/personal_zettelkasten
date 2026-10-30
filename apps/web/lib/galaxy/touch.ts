/**
 * Alvo de toque mínimo de 44 px (`min-h-11 min-w-11`) só em aparelhos de toque.
 * Classes completas, não concatenadas: o Tailwind só gera o que aparece
 * literalmente em `lib/`, `components/` ou `app/`.
 */
export const TOUCH_TARGET = '[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11';

/**
 * Botões do cabeçalho do card. O card vive em coordenadas de mundo e escala
 * com o zoom, então o alvo é um pseudo-elemento cuja altura compensa a escala
 * (`--zk-inv-scale`, escrita pelo motor), com teto de 64 unidades; a largura
 * só avança 8 unidades por lado para não invadir o vizinho (o vão do
 * cabeçalho em toque é de 16).
 */
export const CARD_TOUCH =
  "relative [@media(pointer:coarse)]:px-3 [@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:content-[''] [@media(pointer:coarse)]:before:-left-2 [@media(pointer:coarse)]:before:-right-2 [@media(pointer:coarse)]:before:top-1/2 [@media(pointer:coarse)]:before:-translate-y-1/2 [@media(pointer:coarse)]:before:h-[min(calc(44px*var(--zk-inv-scale,1)),64px)]";
