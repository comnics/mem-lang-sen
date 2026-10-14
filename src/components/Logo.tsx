import { Sprout } from 'lucide-react';
import Link from 'next/link';

export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link className="brand-mark" href={href} aria-label="문장정원 홈">
      <span className="brand-symbol" aria-hidden="true">
        <Sprout size={20} strokeWidth={2.4} />
      </span>
      <span>문장정원</span>
    </Link>
  );
}

export function LogoStatic() {
  return (
    <span className="brand-mark">
      <span className="brand-symbol" aria-hidden="true">
        <Sprout size={20} strokeWidth={2.4} />
      </span>
      <span>문장정원</span>
    </span>
  );
}
