import { splitValue } from '../splitValue';

/** A value with big numerals and small units ("59 bpm"); unparseable text is shown as-is. */
export default function Value({ text, hm = false }: { text: string; hm?: boolean }) {
  return (
    <>
      {splitValue(text, hm).map((p, i) =>
        p.unit ? (
          <span key={i} className="unit">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
