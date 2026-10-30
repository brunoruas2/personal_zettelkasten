import type { CSSProperties, ReactNode } from 'react';

/** Janela do tema ZK//OS. A cor (borda, brilho, barra) vem de `accent`. */
export function Win({
  accent,
  className = '',
  style,
  children,
  as: Tag = 'article',
  label,
  enter = true,
}: {
  accent?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  as?: 'article' | 'section' | 'div' | 'aside';
  label?: string;
  /** Anima a entrada (desligada sob `prefers-reduced-motion` pelo CSS). */
  enter?: boolean;
}) {
  const vars = accent ? ({ ['--zk-accent' as string]: accent } as CSSProperties) : undefined;
  return (
    <Tag aria-label={label} className={`zk-win ${enter ? 'zk-win-enter' : ''} ${className}`} style={{ ...vars, ...style }}>
      {children}
    </Tag>
  );
}

/** Barra de título: texto à esquerda, controles decorativos à direita. */
export function TitleBar({
  children,
  onClose,
  closeLabel = 'Fechar',
  className = '',
}: {
  children: ReactNode;
  /** Quando existe, o "x" vira um botão real. */
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
}) {
  return (
    <div className={`zk-titlebar ${className}`}>
      <span className="truncate">{children}</span>
      <span className="flex-none">
        <span aria-hidden="true" className="zk-ctl">_</span>
        <span aria-hidden="true" className="zk-ctl">□</span>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label={closeLabel} className="zk-ctl" style={{ background: 'transparent', cursor: 'pointer' }}>
            x
          </button>
        ) : (
          <span aria-hidden="true" className="zk-ctl">x</span>
        )}
      </span>
    </div>
  );
}

/** Rodapé da janela. `mode="edit"` fica âmbar ("-- INSERIR --"). */
export function StatusBar({
  left,
  right,
  mode = 'read',
}: {
  left?: ReactNode;
  right?: ReactNode;
  mode?: 'read' | 'edit';
}) {
  return (
    <div className="zk-statusbar" data-mode={mode}>
      <span className="min-w-0 truncate">{left}</span>
      <span className="flex-none">{right}</span>
    </div>
  );
}
