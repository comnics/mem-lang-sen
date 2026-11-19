import { describe,it,expect } from 'vitest';
import { personalSentenceSchema,personalDuplicateKey,validatePersonalRows,personalRowSchema,personalSetSchema,personalSetPatchSchema } from '@/domain/personal-sentences';
describe('personal set PATCH contract',()=>{
 it('keeps create defaults out of omitted PATCH fields',()=>{
  expect(personalSetSchema.parse({title:'새 세트'})).toEqual({title:'새 세트',description:'',category:'SITUATION',level:'A1'});
  expect(personalSetPatchSchema.parse({})).toEqual({});
  expect(personalSetPatchSchema.parse({title:' 새 이름 '})).toEqual({title:'새 이름'});
 });
 it('still normalizes, validates and accepts explicit metadata resets',()=>{
  expect(personalSetPatchSchema.parse({description:'',category:'SITUATION',level:'A1'})).toEqual({description:'',category:'SITUATION',level:'A1'});
  expect(personalSetPatchSchema.parse({description:' 설명  보존 '})).toEqual({description:'설명 보존'});
  for(const input of [{title:''},{description:'x'.repeat(501)},{category:'OTHER'},{level:'C2'},{ownerId:'injected'}])expect(personalSetPatchSchema.safeParse(input).success).toBe(false);
 });
});
describe('personal sentence contract',()=>{
 it('requires independent prompt and target; never invents a question',()=>{expect(personalSentenceSchema.safeParse({target:'Hello'}).success).toBe(false);expect(personalSentenceSchema.safeParse({prompt:'인사',target:''}).success).toBe(false);});
 it('normalizes NFC/spacing but preserves case and punctuation',()=>{expect(personalDuplicateKey({prompt:'  물  부탁 ',target:' Yes! '})).toBe(personalDuplicateKey({prompt:'물 부탁',target:'Yes!'}));expect(personalDuplicateKey({prompt:'물',target:'Yes!'})).not.toBe(personalDuplicateKey({prompt:'물',target:'yes'}));expect(personalDuplicateKey({prompt:'e\u0301',target:'A'})).toBe(personalDuplicateKey({prompt:'é',target:'A'}));});
 it('includes target and deduplicates before final maximum of twelve',()=>{const value=personalSentenceSchema.parse({prompt:'질문',target:'Hello',acceptedAnswers:['Hello',' Hello ']});expect(value.acceptedAnswers).toEqual(['Hello']);expect(personalSentenceSchema.parse({prompt:'질문',target:'Hello',acceptedAnswers:Array(13).fill('Hello')}).acceptedAnswers).toEqual(['Hello']);expect(personalSentenceSchema.safeParse({prompt:'질문',target:'Hello',acceptedAnswers:Array.from({length:12},(_,i)=>String(i))}).success).toBe(false);});
 it.each(['ownerId','audioAssetId','scope','status'])('rejects server-only %s injection',(field)=>{expect(personalSentenceSchema.safeParse({prompt:'질문',target:'Answer',[field]:'anything'}).success).toBe(false);});
 it('enforces field limits, en and levels',()=>{for(const field of ['prompt','target','meaning','hint'])expect(personalSentenceSchema.safeParse({prompt:'질문',target:'Answer',[field]:'x'.repeat(501)}).success).toBe(false);expect(personalSentenceSchema.safeParse({prompt:'질문',target:'Answer',explanation:'x'.repeat(1001)}).success).toBe(false);expect(personalSentenceSchema.safeParse({prompt:'질문',target:'Answer',language:'ko'}).success).toBe(false);});
 it('retains invalid rows and positions for editable preview',()=>{const result=validatePersonalRows([personalRowSchema.parse({row:7,target:'Answer'})]);expect(result.rows[0].row).toBe(7);expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({row:7,field:'prompt'})]));});
});
