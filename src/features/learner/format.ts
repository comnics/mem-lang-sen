export function formatDate(value: string | Date | null | undefined, timeZone = 'Asia/Seoul') {
  if (!value) return '기록 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatLocalDate(value: string | Date | null | undefined, timeZone = 'Asia/Seoul') {
  if (!value) return '일정 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(value));
}

export function todayLocalDate(timeZone = 'Asia/Seoul') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
