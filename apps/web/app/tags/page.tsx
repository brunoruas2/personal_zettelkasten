'use client';

import { useRouter } from 'next/navigation';
import { TagsPanel } from '../../components/panels/TagsPanel';

// Casca da rota antiga: o conteúdo mora no painel, que a galáxia abre em modal.
export default function TagsPage() {
  const router = useRouter();
  return <TagsPanel onBack={() => router.back()} />;
}
