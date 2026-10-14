export type GradeOutcome = {
  correct: boolean;
  normalizedAnswer: string;
  normalizedAcceptedAnswers: string[];
};

export function normalizeAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/[.,!?;:()[\]{}"'`~]/g, '')
    .replace(/\s+/g, ' ');
}

export function gradeWrittenAnswer(answer: string, acceptedAnswers: string[]): GradeOutcome {
  const normalizedAnswer = normalizeAnswer(answer);
  const normalizedAcceptedAnswers = acceptedAnswers.map(normalizeAnswer).filter(Boolean);
  return {
    correct: normalizedAcceptedAnswers.includes(normalizedAnswer),
    normalizedAnswer,
    normalizedAcceptedAnswers,
  };
}
