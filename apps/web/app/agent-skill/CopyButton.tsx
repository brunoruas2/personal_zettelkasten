'use client';

import { useState } from 'react';
import styles from './page.module.css';

/**
 * Único subcomponente client da página: copia o texto de `targetId` pro
 * clipboard. Isolado aqui pra `page.tsx` continuar um Server Component puro
 * (ver design.md — a página inteira precisa vir pronta no HTML inicial,
 * sem depender de hidratação, já que o consumidor típico é um agente que só
 * faz fetch/curl, não um navegador).
 */
export function CopyButton({ targetId, label = 'Copiar' }: { targetId: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleClick = () => {
    try {
      const el = document.getElementById(targetId);
      const text = el?.innerText ?? '';
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      });
    } catch {
      // Clipboard indisponível (contexto não seguro, permissão negada) — sem
      // fallback visível, o texto ainda está selecionável no bloco de código.
    }
  };

  return (
    <button type="button" className={`${styles.copyBtn} ${copied ? styles.copied : ''}`} onClick={handleClick}>
      {copied ? 'Copiado' : label}
    </button>
  );
}
