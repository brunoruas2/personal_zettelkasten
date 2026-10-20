'use client';

import { useRouter } from 'next/navigation';
import { SettingsPanel } from '../../components/panels/SettingsPanel';

// Casca da rota antiga: o conteúdo mora no painel, que a galáxia abre em modal.
export default function SettingsPage() {
  const router = useRouter();
  return <SettingsPanel onBack={() => router.back()} />;
}
