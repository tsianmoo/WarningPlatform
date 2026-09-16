import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

export type CalcExprEditorHandle = {
  /** 在光标处插入一个字段标签（会切成标签块） */
  insertField: (name: string) => void;
  /** 在光标处插入普通文本（函数模板等），光标置于指定偏移处 */
  insertText: (text: string, caret?: number) => void;
};

type Seg = { type: 'text' | 'field'; value: string };

function parseSegs(s: string): Seg[] {
  const out: Seg[] = [];
  const re = /\[([^\[\]]*)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ type: 'text', value: s.slice(last, m.index) });
    out.push({ type: 'field', value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ type: 'text', value: s.slice(last) });
  if (out.length === 0) out.push({ type: 'text', value: '' });
  return out;
}

interface Props {
  value: string;
  onChange: (s: string) => void;
  onFocus: () => void;
  placeholder?: string;
}

const CalcExprEditor = forwardRef<CalcExprEditorHandle, Props>(function CalcExprEditor(
  { value, onChange, onFocus, placeholder },
  ref
) {
  const [local, setLocal] = useState(value);
  const [epoch, setEpoch] = useState(0); // 段结构变化时 +1，强制重建 input 保住正确初值
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const activeRef = useRef<{ seg: number; pos: number }>({ seg: -1, pos: 0 });
  const lastRef = useRef(value);

  const segs = useMemo(() => parseSegs(local), [local]);

  // 外部值（如切换节点/其它编辑）变化时同步，避免循环
  useEffect(() => {
    if (value !== lastRef.current) {
      lastRef.current = value;
      setLocal(value);
    }
  }, [value]);

  const serialize = (): string => {
    let out = '';
    segs.forEach((sg, i) => {
      if (sg.type === 'field') out += '[' + sg.value + ']';
      else out += inputRefs.current[i] ? inputRefs.current[i]!.value : sg.value;
    });
    return out;
  };

  const emit = (s: string) => {
    lastRef.current = s;
    setLocal(s);
    onChange(s);
  };

  const queueFocus = (seg: number, pos: number) => {
    setTimeout(() => {
      const el = inputRefs.current[seg];
      if (el) {
        el.focus();
        const p = Math.max(0, Math.min(pos, el.value.length));
        el.setSelectionRange(p, p);
      }
    }, 0);
  };

  useImperativeHandle(ref, () => ({
    insertField(name: string) {
      const tok = '[' + name + ']';
      const { seg, pos } = activeRef.current;
      const sg = seg >= 0 ? segs[seg] : undefined;
      let newStr: string;
      let fromIdx = seg >= 0 ? seg : 0;
      if (sg && sg.type === 'text') {
        const el = inputRefs.current[seg];
        const p = el && el === document.activeElement ? (el.selectionStart ?? pos) : pos;
        newStr = serializeReplace(segs, seg, sg.value.slice(0, p) + tok + sg.value.slice(p));
      } else {
        newStr = local + tok;
        fromIdx = -1; // 追加到最后，从末尾找刚插入的字段
      }
      emit(newStr);
      setEpoch((e) => e + 1); // 文本段被切分，需重建 input
      // 定位到插入字段之后的文本段，便于继续输入
      const ns = parseSegs(newStr);
      let target = -1;
      if (fromIdx >= 0) {
        for (let k = fromIdx; k < ns.length; k++) {
          if (ns[k].type === 'field' && ns[k].value === name) {
            for (let m = k + 1; m < ns.length; m++) {
              if (ns[m].type === 'text') {
                target = m;
                break;
              }
            }
            break;
          }
        }
      } else {
        for (let k = ns.length - 1; k >= 0; k--) {
          if (ns[k].type === 'field' && ns[k].value === name) {
            for (let m = k + 1; m < ns.length; m++) {
              if (ns[m].type === 'text') {
                target = m;
                break;
              }
            }
            break;
          }
        }
      }
      queueFocus(target, 0);
    },
    insertText(text: string, caret = -1) {
      const { seg, pos } = activeRef.current;
      const sg = seg >= 0 ? segs[seg] : undefined;
      if (sg && sg.type === 'text') {
        const el = inputRefs.current[seg];
        const p = el && el === document.activeElement ? (el.selectionStart ?? pos) : pos;
        const newV = sg.value.slice(0, p) + text + sg.value.slice(p);
        const nextSegs = parselessReplace(segs, seg, newV);
        emit(segsToStr(nextSegs));
        if (el) el.value = newV;
        const caretPos = caret >= 0 ? p + caret : p + text.length;
        queueFocus(seg, caretPos);
      } else {
        emit(local + text);
        queueFocus(segs.length - 1, local.length + (caret >= 0 ? caret : text.length));
      }
    },
  }));

  const onInput = () => emit(serialize());

  const track = (i: number, e: React.SyntheticEvent<HTMLInputElement>) => {
    const el = e.target as HTMLInputElement;
    activeRef.current = { seg: i, pos: el.selectionStart ?? 0 };
    onFocus();
  };

  const delField = (i: number) => {
    const nextSegs = segs.filter((_, idx) => idx !== i);
    emit(segsToStr(nextSegs));
    setEpoch((e) => e + 1);
    queueFocus(Math.max(0, i - 1), 0);
  };

  return (
    <div className="flex w-full flex-wrap items-center gap-0.5 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus-within:border-blue-400">
      {segs.map((sg, i) =>
        sg.type === 'text' ? (
          <input
            key={`t:${i}:${epoch}`}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            defaultValue={sg.value}
            onInput={onInput}
            onFocus={(e) => track(i, e)}
            onClick={(e) => track(i, e)}
            onKeyUp={(e) => track(i, e as React.KeyboardEvent<HTMLInputElement>)}
            className="min-w-[2em] flex-1 border-none bg-transparent outline-none"
            placeholder={sg.value ? undefined : placeholder}
          />
        ) : (
          <span
            key={`f:${i}:${epoch}`}
            className="inline-flex items-center gap-0.5 rounded bg-blue-100 px-1 text-blue-700"
          >
            {sg.value}
            <button
              type="button"
              title="删除该字段"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault();
                delField(i);
              }}
              className="text-blue-400 hover:text-red-500"
            >
              ✕
            </button>
          </span>
        )
      )}
    </div>
  );
});

function serializeReplace(segs: Seg[], idx: number, newVal: string): string {
  const next = segs.map((sg, i) => (i === idx ? { ...sg, value: newVal } : sg));
  return segsToStr(next);
}

function parselessReplace(segs: Seg[], idx: number, newVal: string): Seg[] {
  return segs.map((sg, i) => (i === idx ? { ...sg, value: newVal } : sg));
}

function segsToStr(segs: Seg[]): string {
  return segs.map((sg) => (sg.type === 'field' ? '[' + sg.value + ']' : sg.value)).join('');
}

export default CalcExprEditor;