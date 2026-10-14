export type Level = 'A1' | 'A2' | 'B1';
export type SetCategory = 'SITUATION' | 'PATTERN' | 'FUNCTION';
export type SetStatus = 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';

export type AdminSentenceVersion = {
  id: string;
  prompt: string;
  meaning: string;
  target: string;
  acceptedAnswers: string[];
  hint: string;
  explanation: string;
  language: 'en';
  level: Level;
  audioAssetId?: string | null;
  createdAt?: string;
};

export type AdminSentence = {
  id: string;
  sentenceId?: string;
  versionNumber?: number;
  prompt?: string;
  meaning?: string;
  target?: string;
  acceptedAnswers?: string[];
  hint?: string;
  explanation?: string;
  level?: Level;
  language?: 'en';
  versionId?: string;
  audioAssetId?: string | null;
  currentVersion?: AdminSentenceVersion;
  versions?: AdminSentenceVersion[];
  createdAt?: string;
  updatedAt?: string;
};

export type AdminSet = {
  id: string;
  title: string;
  description: string;
  category: SetCategory;
  level: Level;
  status: SetStatus;
  sentenceCount?: number;
  sentenceVersionIds?: string[];
  sentences?: Array<{ sentenceVersionId?: string; versionId?: string; id?: string }>;
  items?: Array<{ sentenceVersionId?: string; versionId?: string; id?: string }>;
  createdAt?: string;
  updatedAt?: string;
};

export type Notice = {
  tone: 'success' | 'error' | 'info';
  text: string;
};

export type CsvPreviewRow = {
  row: number;
  prompt?: string;
  meaning?: string;
  target?: string;
  acceptedAnswers?: string[];
  hint?: string;
  explanation?: string;
  level?: Level;
};

export type CsvImportResponse = {
  rows: CsvPreviewRow[];
  errors: Array<{ row: number; message: string }>;
  imported?: number;
};

export function sentenceVersion(sentence: AdminSentence): AdminSentenceVersion {
  if (sentence.currentVersion) {
    return sentence.currentVersion;
  }

  if (sentence.versions?.length) {
    return sentence.versions[0];
  }

  return {
    id: sentence.versionId ?? sentence.id,
    prompt: sentence.prompt ?? '',
    meaning: sentence.meaning ?? '',
    target: sentence.target ?? '',
    acceptedAnswers: sentence.acceptedAnswers ?? [],
    hint: sentence.hint ?? '',
    explanation: sentence.explanation ?? '',
    language: sentence.language ?? 'en',
    level: sentence.level ?? 'A1',
    audioAssetId: sentence.audioAssetId,
  };
}

export function setSentenceVersionIds(set: AdminSet): string[] {
  if (set.sentenceVersionIds?.length) {
    return set.sentenceVersionIds;
  }

  return (set.sentences ?? set.items ?? [])
    .map((item) => item.sentenceVersionId ?? item.versionId ?? item.id)
    .filter((id): id is string => Boolean(id));
}
