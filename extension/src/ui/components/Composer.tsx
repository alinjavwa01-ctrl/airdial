import { useEffect, useRef, useState } from 'react';
import { SendIcon } from './icons';

export function Composer(props: { placeholder: string; onSubmit: (text: string) => void; disabled?: boolean; suggestions?: string[]; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || props.disabled) return;
    props.onSubmit(t);
    setText('');
  };

  return (
    <div className="composer">
      {props.suggestions && !text && (
        <div className="suggestions">
          {props.suggestions.map((s) => (
            <button key={s} type="button" className="btn small" onClick={() => setText(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="composer-box">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          autoFocus={props.autoFocus}
          aria-label={props.placeholder}
          placeholder={props.placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="send" aria-label="Start" disabled={!text.trim() || props.disabled} onClick={submit}>
          <SendIcon />
        </button>
      </div>
    </div>
  );
}
