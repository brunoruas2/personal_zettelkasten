'use client';

/**
 * Chip de tag da galáxia. Com `onTag` é um botão que liga/desliga o filtro de
 * tag da câmera; sem ele continua só texto. `data-no-pan` mantém o clique
 * fora do arraste do motor.
 */
export function TagChip({
  tag,
  label,
  active = false,
  onTag,
  className,
}: {
  tag: string;
  /** Texto exibido (padrão: a própria tag). */
  label?: string;
  active?: boolean;
  onTag?: (tag: string) => void;
  className: string;
}) {
  if (!onTag) return <span className={className}>{label ?? tag}</span>;
  return (
    <button
      type="button"
      data-no-pan
      aria-pressed={active}
      title={active ? `Limpar o filtro ${tag}` : `Filtrar a galáxia por ${tag}`}
      onClick={(e) => {
        e.stopPropagation();
        onTag(tag);
      }}
      className={`${className} cursor-pointer hover:bg-white/10 ${active ? 'ring-1 ring-brand/70' : ''}`}
    >
      {label ?? tag}
    </button>
  );
}
