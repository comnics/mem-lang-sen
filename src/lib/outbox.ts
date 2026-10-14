'use client';

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ITEMS = 20;
const PREFIX = 'mem-lang-sen:outbox:v1:';

export type OutboxPayload = {
  itemId: string;
  eventId: string;
  answer?: string;
  selfRating?: 'AGAIN' | 'GOOD';
  hard?: boolean;
};

export type OutboxItem = {
  ownerId: string;
  sessionId: string;
  payload: OutboxPayload;
  createdAt: number;
};

export function outboxKey(ownerId: string, sessionId: string) {
  return `${PREFIX}${ownerId}:${sessionId}`;
}

export function loadOutbox(ownerId: string, sessionId: string, storage: Storage = sessionStorage): OutboxItem[] {
  const items = pruneOutbox(parse(storage.getItem(outboxKey(ownerId, sessionId))), ownerId, sessionId, Date.now());
  const parsed = parse(storage.getItem(outboxKey(ownerId, sessionId)));
  if (items.length !== parsed.length) saveAll(ownerId, sessionId, items, storage);
  return items;
}

export function saveOutboxItem(item: OutboxItem, storage: Storage = sessionStorage) {
  const current = loadOutbox(item.ownerId, item.sessionId, storage);
  const existing = current.find((entry) => entry.payload.eventId === item.payload.eventId);
  const items = current.filter((entry) => entry.payload.eventId !== item.payload.eventId);
  items.push({ ...item, createdAt: existing?.createdAt ?? item.createdAt });
  saveAll(item.ownerId, item.sessionId, items.slice(-MAX_ITEMS), storage);
}

export function removeOutboxItem(ownerId: string, sessionId: string, eventId: string, storage: Storage = sessionStorage) {
  saveAll(ownerId, sessionId, loadOutbox(ownerId, sessionId, storage).filter((item) => item.payload.eventId !== eventId), storage);
}

export function clearOwnerOutbox(ownerId: string, storage: Storage = sessionStorage) {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(`${PREFIX}${ownerId}:`)) storage.removeItem(key);
  }
}

export function countOwnerOutbox(ownerId: string, storage: Storage = sessionStorage) {
  let count = 0;
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(`${PREFIX}${ownerId}:`)) continue;
    count += parse(storage.getItem(key)).filter((item) => item.ownerId === ownerId && Date.now() - item.createdAt <= TTL_MS).length;
  }
  return count;
}

export function pruneOutbox(items: OutboxItem[], ownerId: string, sessionId: string, now: number) {
  return items.filter((item) => item.ownerId === ownerId && item.sessionId === sessionId && now - item.createdAt <= TTL_MS).slice(-MAX_ITEMS);
}

function saveAll(ownerId: string, sessionId: string, items: OutboxItem[], storage: Storage) {
  storage.setItem(outboxKey(ownerId, sessionId), JSON.stringify(items));
}

function parse(value: string | null): OutboxItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isItem) : [];
  } catch {
    return [];
  }
}

function isItem(value: unknown): value is OutboxItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<OutboxItem>;
  return Boolean(item.ownerId && item.sessionId && item.payload?.eventId && item.payload.itemId && Number.isFinite(item.createdAt));
}
