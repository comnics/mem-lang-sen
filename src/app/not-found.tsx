import Link from 'next/link';
export default function NotFound() {
  return <main className="public-shell stack-lg"><section className="card stack"><h1>페이지를 찾을 수 없어요</h1><p>주소를 확인하거나 처음 화면에서 다시 시작해 주세요.</p><Link className="button" href="/">처음으로</Link></section></main>;
}
