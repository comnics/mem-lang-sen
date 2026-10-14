import { createHash } from 'node:crypto';
import { conversationTopics } from './conversation';

export function seedDigest(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

function expandContractions(value: string) {
  return value.replace(/\bI'm\b/g, 'I am').replace(/\bI'd\b/g, 'I would')
    .replace(/\bI'll\b/g, 'I will').replace(/\bI've\b/g, 'I have')
    .replace(/\bcan't\b/g, 'cannot').replace(/\bdon't\b/g, 'do not')
    .replace(/\bdidn't\b/g, 'did not').replace(/\bisn't\b/g, 'is not')
    .replace(/\bwon't\b/g, 'will not').replace(/\bit's\b/gi, (word) => word[0] === 'I' ? 'It is' : 'it is');
}

export const conversationCatalog = conversationTopics.map((topic) => ({
  key: topic.key,
  title: `${topic.group} · ${topic.title}`,
  description: `${topic.description} 필수 표현 6문장을 회상하고 반복합니다. 음원은 합성 음성입니다.`,
  level: topic.level,
  sentences: topic.sentences.map(([prompt, target, ...alternatives], index) => ({
    // Identity follows the topic and fixed position; content revisions create new versions.
    id: `ctopicphrase${seedDigest(`${topic.key}:${index + 1}`)}`,
    audioFile: `conversation-${seedDigest(target)}.wav`,
    data: {
      prompt,
      meaning: `${topic.group} / ${topic.title}: ${topic.description}`,
      target,
      acceptedAnswers: [...new Set([target, ...alternatives].flatMap((answer) => [answer, expandContractions(answer)]))],
      hint: `“${target.split(' ').slice(0, 2).join(' ')}”로 시작해 보세요.`,
      explanation: `${topic.pattern} “${target}”는 “${prompt}”라는 뜻입니다.`,
      language: 'en',
      level: topic.level,
    },
  })),
}));
