/** Selo "agente" da galáxia: zettel que o agente de IA acabou de alterar. */
export function AgentBadge({ className = '' }: { className?: string }) {
  return (
    <span
      title="Alterado agora pelo agente"
      className={`inline-flex items-center gap-1 rounded-full bg-brand/20 px-2 py-0.5 text-[11px] font-medium text-brand-light ${className}`}
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-light" />
      agente
    </span>
  );
}
