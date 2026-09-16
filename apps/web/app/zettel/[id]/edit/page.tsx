'use client';

import { useParams } from 'next/navigation';
import { ZettelEditForm } from '../../../../components/ZettelEditForm';

export default function EditZettelPage() {
  const { id } = useParams<{ id: string }>();
  return <ZettelEditForm zettelId={id} layout="page" />;
}
