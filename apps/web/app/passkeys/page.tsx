'use client';

import { useRouter } from 'next/navigation';
import { PasskeysPanel } from '../../components/panels/PasskeysPanel';

// Casca da rota antiga: o conteúdo mora no painel, que a galáxia abre em modal.
export default function PasskeysPage() {
  const router = useRouter();
  return <PasskeysPanel onBack={() => router.back()} />;
}
