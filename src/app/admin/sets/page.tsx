import { requirePageUser } from '@/server/auth';
import { SetsWorkspace } from '@/features/admin/sets-workspace';
import type { AdminSentence, AdminSet } from '@/features/admin/types';
import { adminListSentences, adminListSets } from '@/server/services/content';

export default async function AdminSetsPage() {
  await requirePageUser(true);
  const [sets, sentences] = await Promise.all([adminListSets(), adminListSentences()]);

  return <SetsWorkspace initialSets={sets as AdminSet[]} sentences={sentences as AdminSentence[]} />;
}
