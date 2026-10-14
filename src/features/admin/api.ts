'use client';

import type { CsvImportResponse, Level, SetCategory } from './types';

type JsonRecord = Record<string, unknown>;

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as JsonRecord;

  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : '요청을 처리하지 못했습니다.');
  }

  return payload as T;
}

export async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/admin${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });

  return readJson<T>(response);
}

export type SentencePayload = {
  prompt: string;
  meaning: string;
  target: string;
  acceptedAnswers: string[];
  hint: string;
  explanation: string;
  language: 'en';
  level: Level;
  audioAssetId?: string;
};

export type SetPayload = {
  title: string;
  description: string;
  category: SetCategory;
  level: Level;
  sentenceVersionIds: string[];
};

export async function saveSentence(payload: SentencePayload, id?: string) {
  return adminRequest('/sentences' + (id ? `/${id}` : ''), {
    method: id ? 'PATCH' : 'POST',
    body: JSON.stringify(payload),
  });
}

export async function saveSet(payload: SetPayload, id?: string) {
  return adminRequest('/sets' + (id ? `/${id}` : ''), {
    method: id ? 'PATCH' : 'POST',
    body: JSON.stringify(payload),
  });
}

export async function transitionSet(id: string, action: 'review' | 'publish' | 'clone') {
  return adminRequest(`/sets/${id}/${action}`, { method: 'POST', body: '{}' });
}

export async function archiveSet(id: string) {
  return adminRequest(`/sets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'ARCHIVED' }),
  });
}

export async function importCsv(csv: string, commit: boolean): Promise<CsvImportResponse> {
  return adminRequest('/imports', {
    method: 'POST',
    body: JSON.stringify({ csv, commit }),
  });
}

export async function uploadAudio(file: File): Promise<string> {
  const signed = await adminRequest<{
    id: string;
    path: string;
    token: string;
    signedUrl: string;
  }>('/audio', {
    method: 'POST',
    body: JSON.stringify({
      action: 'sign',
      fileName: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });

  const { createClient } = await import('@/lib/supabase/client');
  const supabase = createClient();
  const bucket = process.env.NEXT_PUBLIC_SUPABASE_AUDIO_BUCKET ?? 'sentence-audio';
  const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(signed.path, signed.token, file);

  if (error) {
    throw new Error(error.message);
  }

  const completed = await adminRequest<{ id: string }>('/audio', {
    method: 'POST',
    body: JSON.stringify({ action: 'complete', id: signed.id }),
  });

  return completed.id;
}
