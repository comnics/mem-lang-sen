import { requirePageUser } from '@/server/auth';
import { getPersonalSet } from '@/server/services/personal-content';
import { PersonalSetWorkspace } from '@/features/learner/PersonalSentencesClient';
import { PageHeader } from '@/components/PageHeader';
import { HttpError } from '@/server/http';
import { notFound } from 'next/navigation';
export const dynamic='force-dynamic';
export default async function PersonalSetPage({params}:{params:Promise<{id:string}>}){
 const user=await requirePageUser();const {id}=await params;
 let set: Awaited<ReturnType<typeof getPersonalSet>>;
 try{set=await getPersonalSet(user.id,id);}catch(error){if(error instanceof HttpError&&error.status===404)notFound();throw error;}
 return <><PageHeader eyebrow="비공개 개인" title={set.title}>직접 입력·가져오기·편집·학습</PageHeader><PersonalSetWorkspace initialSet={set}/></>;
}
