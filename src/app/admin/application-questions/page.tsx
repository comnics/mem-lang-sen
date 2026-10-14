import { requirePageUser } from '@/server/auth';
import { adminListSentences } from '@/server/services/content';
import { adminListApplicationQuestions } from '@/server/services/application-questions';
import { ApplicationQuestionsClient } from '@/features/admin/application-questions-client';
import { PageHeader } from '@/features/admin/ui';

export default async function AdminApplicationQuestionsPage() {
  await requirePageUser(true);
  const [questions, sentences] = await Promise.all([adminListApplicationQuestions(), adminListSentences()]);
  return (
    <>
      <PageHeader title="응용 문항" description="원 문장과 분리된 상황 단서 문항을 만들고 검수 상태를 관리합니다." />
      <ApplicationQuestionsClient
        initialQuestions={questions}
        sentences={sentences.map((sentence) => ({ id: sentence.id, prompt: sentence.prompt, meaning: sentence.meaning, target: sentence.target }))}
      />
    </>
  );
}
