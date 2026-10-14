import { requirePageUser } from '@/server/auth';
import { ImportWorkspace } from '@/features/admin/import-workspace';

export default async function AdminImportsPage() {
  await requirePageUser(true);
  return <ImportWorkspace />;
}
