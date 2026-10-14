import { requirePageUser } from '@/server/auth';
import { AdminDashboard } from '@/features/admin/dashboard';
import type { AdminSentence, AdminSet } from '@/features/admin/types';
import { adminListSentences, adminListSets } from '@/server/services/content';

export default async function AdminPage() {
  await requirePageUser(true);
  const [sets, sentences] = await Promise.all([adminListSets(), adminListSentences()]);

  return <AdminDashboard sets={sets as AdminSet[]} sentences={sentences as AdminSentence[]} />;
}
