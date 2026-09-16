import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';

export type CalcExprEditorHandle = {
  /** 在光标处插入一个字段标签（不可编辑块） */
  insertField: (name: string) => void;
  /** 在光标处插入普通文本（计算符号/函数模板等），caret 指定插入文本内部的光标偏移（-1 末尾） */
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

const FIELD_CLASS = 'mx-0.5 inline-flex items-center gap-0.5 rounded bg-blue-100 px-1 text-blue-700';

const CalcExprEditor = forwardRef<CalcExprEditorHandle, Props>(function CalcExprEditor(
  { value, onChange, onFocus, placeholder },
  ref
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef(value);

  const makeField = (name: string): HTMLElement => {
    const span = document.createElement('span');
    span.contentEditable = 'false';
    span.className = FIELD_CLASS;
    span.dataset.field = name;
    const lab = document.createElement('span');
    lab.textContent = name;
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '✕';
    del.title = '删除该字段';
    del.className = 'cursor-pointer text-blue-400 hover:text-red-500';
    del.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      span.remove();
      flush();
    });
    span.appendChild(lab);
    span.appendChild(del);
    return span;
  };

  const build = (s: string) => {
    const root = rootRef.current;
    if (!root) return;
    root.innerHTML = '';
    const frag = document.createDocumentFragment();
    parseSegs(s).forEach((sg) => {
      if (sg.type === 'field') frag.appendChild(makeField(sg.value));
      else frag.appendChild(document.createTextNode(sg.value));
    });
    root.appendChild(frag);
  };

  const serialize = (): string => {
    const root = rootRef.current;
    if (!root) return value;
    let out = '';
    root.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.textContent ?? '';
      } else if (n.nodeType === Node.ELEMENT_NODE) {
        const f = (n as HTMLElement).getAttribute('data-field');
        if (f != null) out += '[' + f + ']';
      }
    });
    return out;
  };

  const flush = () => {
    const s = serialize();
    lastRef.current = s;
    onChange(s);
  };

  const placeRange = (r: Range) => {
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(r);
    rootRef.current?.focus();
  };

  // 初始挂载构建一次内容
  useLayoutEffect(() => {
    build(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部 value 与本地不一致（切换节点/其它编辑）时重建，避免光标被重置
  useEffect(() => {
    if (value !== lastRef.current) {
      lastRef.current = value;
      build(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useImperativeHandle(ref, () => ({
    insertField(name: string) {
      const root = rootRef.current;
      if (!root) return;
      root.focus();
      const span = makeField(name);
      const sel = window.getSelection();
      const hasSel = !!sel && sel.rangeCount > 0 && root.contains(sel.anchorNode);
      if (!hasSel) {
        root.appendChild(span);
        const r = document.createRange();
        r.setStartAfter(span);
        r.collapse(true);
        placeRange(r);
      } else {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(span);
        range.setStartAfter(span);
        range.collapse(true);
        placeRange(range);
      }
      flush();
    },
    insertText(text: string, caret = -1) {
      const root = rootRef.current;
      if (!root) return;
      root.focus();
      const tn = document.createTextNode(text);
      const sel = window.getSelection();
      const hasSel = !!sel && sel.rangeCount > 0 && root.contains(sel.anchorNode);
      const pos = caret >= 0 ? caret : text.length;
      if (!hasSel) {
        root.appendChild(tn);
        const r = document.createRange();
        r.setStart(tn, Math.max(0, Math.min(pos, tn.length)));
        r.collapse(true);
        placeRange(r);
      } else {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(tn);
        range.setStart(tn, Math.max(0, Math.min(pos, tn.length)));
        range.collapse(true);
        placeRange(range);
      }
      flush();
    },
  }));

  return (
    <div
      ref={rootRef}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onInput={flush}
      onFocus={onFocus}
      data-placeholder={placeholder}
      className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs leading-relaxed text-gray-700 outline-none focus:ring-1 focus:ring-fuchsia-400 empty:before:text-gray-400 empty:before:content-[attr(data-placeholder)]"
    />
  );
});

export default CalcExprEditor;