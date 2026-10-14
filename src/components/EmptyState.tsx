import type { ReactNode } from 'react';

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="empty-state">
      <strong>{title}</strong>
      <div>{children}</div>
      {action}
    </section>
  );
}
