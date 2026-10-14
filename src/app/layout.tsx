import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '문장정원',
    template: '%s | 문장정원',
  },
  description: '짧은 문장을 직접 떠올리고 비교하는 영어 회상 학습 노트',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
