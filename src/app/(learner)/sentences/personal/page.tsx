import Link from 'next/link';
import { requirePageUser } from '@/server/auth';
import { listPersonalSets } from '@/server/services/personal-content';
import { PersonalSetList } from '@/features/learner/PersonalSentencesClient';
import { PageHeader } from '@/components/PageHeader';
export const dynamic='force-dynamic';
export default async function PersonalSentencesPage(){const user=await requirePageUser();return <><PageHeader eyebrow="내 문장" title="직접 만든 문장">나만 볼 수 있는 문장을 만들고 기존 학습에서 연습합니다.</PageHeader><Link href="/sentences">연습 기록 보기</Link><PersonalSetList initialSets={await listPersonalSets(user.id)}/></>;}
