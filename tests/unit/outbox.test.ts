import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOwnerOutbox, countOwnerOutbox, loadOutbox, outboxKey, pruneOutbox, removeOutboxItem, saveOutboxItem, type OutboxItem } from '@/lib/outbox';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length() {
    return this.data.size;
  }

  clear() {
    this.data.clear();
  }

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.data.delete(key);
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

const now = new Date('2026-10-14T00:00:00.000Z').getTime();

describe('session outbox', () => {
  beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now); });
  afterEach(() => vi.restoreAllMocks());
  it('stores frozen payloads by owner and session and preserves event ids', () => {
    const storage = new MemoryStorage();
    const item = outboxItem('user-a', 'session-a', 'item-a', 'event-a');

    saveOutboxItem(item, storage);
    saveOutboxItem({ ...item, payload: { ...item.payload, answer: 'changed' } }, storage);

    expect(loadOutbox('user-a', 'session-a', storage)).toEqual([{ ...item, payload: { ...item.payload, answer: 'changed' } }]);
    expect(loadOutbox('user-b', 'session-a', storage)).toEqual([]);
    expect(storage.getItem(outboxKey('user-a', 'session-a'))).toContain('event-a');
  });


  it('keeps the original createdAt when a retry rewrites the same event payload', () => {
    const storage = new MemoryStorage();
    const original = outboxItem('user-a', 'session-a', 'item-a', 'event-a', now - 60_000);

    saveOutboxItem(original, storage);
    saveOutboxItem({ ...original, createdAt: now + 60_000, payload: { ...original.payload, answer: 'retry payload' } }, storage);

    expect(loadOutbox('user-a', 'session-a', storage)).toEqual([
      { ...original, payload: { ...original.payload, answer: 'retry payload' } },
    ]);
  });

  it('expires old entries and keeps only the most recent twenty submissions', () => {
    const fresh = Array.from({ length: 25 }, (_, index) => outboxItem('user-a', 'session-a', `item-${index}`, `event-${index}`, now + index));
    const old = outboxItem('user-a', 'session-a', 'old-item', 'old-event', now - 25 * 60 * 60 * 1000);

    const pruned = pruneOutbox([old, ...fresh], 'user-a', 'session-a', now + 25);

    expect(pruned).toHaveLength(20);
    expect(pruned[0]?.payload.eventId).toBe('event-5');
    expect(pruned.at(-1)?.payload.eventId).toBe('event-24');
  });

  it('removes accepted events and clears only the signing-out owner', () => {
    const storage = new MemoryStorage();
    saveOutboxItem(outboxItem('user-a', 'session-a', 'item-a', 'event-a'), storage);
    saveOutboxItem(outboxItem('user-a', 'session-b', 'item-b', 'event-b'), storage);
    saveOutboxItem(outboxItem('user-b', 'session-a', 'item-c', 'event-c'), storage);

    removeOutboxItem('user-a', 'session-a', 'event-a', storage);
    expect(countOwnerOutbox('user-a', storage)).toBe(1);

    clearOwnerOutbox('user-a', storage);
    expect(countOwnerOutbox('user-a', storage)).toBe(0);
    expect(countOwnerOutbox('user-b', storage)).toBe(1);
  });
});

function outboxItem(ownerId: string, sessionId: string, itemId: string, eventId: string, createdAt = now): OutboxItem {
  return {
    ownerId,
    sessionId,
    createdAt,
    payload: { itemId, eventId, answer: 'Could you say that again?', hard: false },
  };
}
