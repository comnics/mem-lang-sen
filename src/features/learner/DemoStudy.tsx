'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye, RotateCcw } from 'lucide-react';

const demoItems = [
  {
    prompt: '회의 일정을 다시 잡아야 해요.',
    target: 'I need to reschedule the meeting.',
    meaning: '일정을 바꾸거나 다시 잡을 때 쓰는 문장',
  },
  {
    prompt: '이 부분을 조금 더 설명해 주실 수 있나요?',
    target: 'Could you explain this part a bit more?',
    meaning: '정중하게 추가 설명을 요청하는 문장',
  },
  {
    prompt: '오늘 안으로 확인해서 알려드릴게요.',
    target: 'I will check and let you know by the end of today.',
    meaning: '확인 후 회신하겠다고 약속하는 문장',
  },
];

export function DemoStudy() {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const item = demoItems[index];
  const promptRef = useRef<HTMLParagraphElement>(null);
  const previousIndex = useRef(index);
  useEffect(() => {
    if (previousIndex.current !== index) promptRef.current?.focus();
    previousIndex.current = index;
  }, [index]);

  function next() {
    setIndex((current) => (current + 1) % demoItems.length);
    setAnswer('');
    setRevealed(false);
  }

  return (
    <section className="card stack-lg study-card">
      <div className="page-heading">
        <span className="eyebrow">3문장 체험</span>
        <h1>먼저 떠올리고, 그다음 비교해요.</h1>
        <p>{item.meaning}</p>
      </div>
      <div className="card-quiet">
        <span className="badge">{index + 1} / {demoItems.length}</span>
        <p ref={promptRef} tabIndex={-1} className="recall-prompt" lang="ko">{item.prompt}</p>
      </div>
      <label className="field">
        내가 떠올린 영어 문장
        <textarea
          className="textarea"
          autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder="정답을 보기 전에 먼저 적어 보세요."
        />
      </label>
      {revealed ? (
        <div className="notice notice-success" role="status">
          <strong>비교할 문장</strong>
          <p className="english-phrase" lang="en">{item.target}</p>
        </div>
      ) : null}
      <div className="paired-actions">
        <button className="button" type="button" onClick={() => setRevealed(true)} disabled={!answer.trim()}>
          <Eye size={18} aria-hidden="true" /> 답 보기
        </button>
        <button className="button-secondary" type="button" onClick={next}>
          <RotateCcw size={18} aria-hidden="true" /> 다음 문장
        </button>
      </div>
    </section>
  );
}
