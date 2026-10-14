import { requirePageUser } from '@/server/auth';
import { SentencesWorkspace } from '@/features/admin/sentences-workspace';
import type { AdminSentence } from '@/features/admin/types';
import { adminListSentences } from '@/server/services/content';

export default async function AdminSentencesPage() {
  await requirePageUser(true);
  const sentences = await adminListSentences();

  return <SentencesWorkspace initialSentences={sentences as AdminSentence[]} />;
}
