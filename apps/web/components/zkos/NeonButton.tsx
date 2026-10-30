import type { ButtonHTMLAttributes } from 'react';

/** Botão do tema: `outline` (ciano) ou `hot` (âmbar, canto chanfrado). */
export function NeonButton({
  variant = 'outline',
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'outline' | 'hot' }) {
  return <button type={type} className={`${variant === 'hot' ? 'zk-btn-hot' : 'zk-btn'} ${className}`} {...rest} />;
}
