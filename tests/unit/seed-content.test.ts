import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { conversationCatalog } from '../../prisma/seed-data/catalog';
import { conversationTopics } from '../../prisma/seed-data/conversation';

describe('conversation seed catalog', () => {
  it('covers all requested topics with unique, answerable content', () => {
    expect(conversationTopics).toHaveLength(23);
    expect(Object.fromEntries(['공통 표현', '여행 핵심', '가족 여행', '문제 해결', '일상 확장'].map((group) => [group, conversationTopics.filter((topic) => topic.group === group).length]))).toEqual({ '공통 표현': 5, '여행 핵심': 5, '가족 여행': 4, '문제 해결': 4, '일상 확장': 5 });
    const sentences = conversationCatalog.flatMap((topic) => topic.sentences);
    expect(sentences).toHaveLength(138);
    expect(new Set(sentences.map((sentence) => sentence.id)).size).toBe(138);
    expect(new Set(sentences.map((sentence) => sentence.data.target)).size).toBe(138);
    for (const sentence of sentences) {
      expect(sentence.data.acceptedAnswers).toContain(sentence.data.target);
      for (const value of [sentence.data.prompt, sentence.data.meaning, sentence.data.hint, sentence.data.explanation]) expect(value.trim().length).toBeGreaterThan(0);
    }
  });
  it('ships real WAV fixtures for every published sentence', () => {
    for (const sentence of conversationCatalog.flatMap((topic) => topic.sentences)) {
      const wav = readFileSync(`fixtures/audio/${sentence.audioFile}`);
      expect(wav.subarray(0, 4).toString()).toBe('RIFF');
      expect(wav.subarray(8, 12).toString()).toBe('WAVE');
      expect(wav.length).toBeGreaterThan(1000);
      expect(wav.length).toBeLessThan(10 * 1024 * 1024);
    }
  });
});
