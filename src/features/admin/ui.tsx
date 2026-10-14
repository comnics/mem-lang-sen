import type { Notice } from './types';

export const levels = ['A1', 'A2', 'B1'] as const;
export const categories = [
  { value: 'SITUATION', label: '상황' },
  { value: 'PATTERN', label: '패턴' },
  { value: 'FUNCTION', label: '기능' },
] as const;

export const panelClass = 'rounded-2xl border border-[#d7dfd5] bg-white p-4 shadow-sm md:p-5';
export const buttonClass =
  'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#245d45] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#1e4d39] disabled:cursor-not-allowed disabled:opacity-55 focus:outline-none focus:ring-2 focus:ring-[#245d45] focus:ring-offset-2';
export const secondaryButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#b8c8bd] bg-white px-4 py-2 text-sm font-bold text-[#245d45] transition hover:bg-[#eef3ec] disabled:cursor-not-allowed disabled:opacity-55 focus:outline-none focus:ring-2 focus:ring-[#245d45] focus:ring-offset-2';
export const dangerButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d8b4a8] bg-white px-4 py-2 text-sm font-bold text-[#9a4932] transition hover:bg-[#fff4f0] disabled:cursor-not-allowed disabled:opacity-55 focus:outline-none focus:ring-2 focus:ring-[#bc6143] focus:ring-offset-2';
export const fieldClass =
  'min-h-11 w-full rounded-lg border border-[#cbd8cf] bg-white px-3 py-2 text-sm text-[#203c32] outline-none transition placeholder:text-[#7b8b82] focus:border-[#245d45] focus:ring-2 focus:ring-[#245d45]/20';
export const labelClass = 'text-sm font-bold text-[#203c32]';

export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="mb-5">
      <p className="text-sm font-bold text-[#bc6143]">Admin</p>
      <h1 className="mt-1 text-3xl font-bold tracking-normal text-[#203c32]">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[#52685d]">{description}</p>
    </header>
  );
}

export function NoticeBox({ notice }: { notice?: Notice | null }) {
  if (!notice) {
    return null;
  }

  const toneClass =
    notice.tone === 'success'
      ? 'border-[#b9d6c3] bg-[#edf7ef] text-[#245d45]'
      : notice.tone === 'error'
        ? 'border-[#e2b7aa] bg-[#fff3ef] text-[#8f3f2b]'
        : 'border-[#c7d3c9] bg-[#f4f8f3] text-[#385a4c]';

  return (
    <div role="status" aria-live="polite" className={`rounded-lg border px-3 py-2 text-sm font-semibold ${toneClass}`}>
      {notice.text}
    </div>
  );
}

export function EmptyState({ children }: { children: string }) {
  return <div className="rounded-xl border border-dashed border-[#cbd8cf] bg-[#f9faf6] p-6 text-sm text-[#52685d]">{children}</div>;
}

export function Badge({ children }: { children: string }) {
  return <span className="inline-flex rounded-full bg-[#dce8dd] px-2.5 py-1 text-xs font-bold text-[#245d45]">{children}</span>;
}
