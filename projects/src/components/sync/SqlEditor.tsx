'use client';

import { useMemo, useRef, useState, useEffect } from 'react';

const KEYWORDS =
  /(^|[\s(])(SELECT|FROM|WHERE|AND|OR|NOT|IN|IS|NULL|LIKE|BETWEEN|JOIN|LEFT|RIGHT|INNER|OUTER|FULL|ON|AS|DESC|ASC|ORDER|BY|GROUP|HAVING|UNION|ALL|DISTINCT|CASE|WHEN|THEN|ELSE|END|WITH|EXISTS|BETWEEN|LIMIT|ROWNUM|DUAL)([\s(])/gi;

// 把 SQL 切分为带高亮标记的 token（轻量实现，避免引入 Monaco 原生依赖）
function tokenize(sql: string): string {
  return sql
    .replace(KEYWORDS, '$1<span class="text-blue-600 font-medium">$2</span>$3')
    .replace(/('[^']*')/g, '<span class="text-green-600">$1</span>')
    .replace(/(--.*$)/gm, '<span class="text-gray-400">$1</span>');
}

export interface SqlEditorProps {
  value: string;
  onChange: (v: string) => void;
  datasourceName?: string;
  schemaNames?: string[];
  tableNames?: string[];
  columnNames?: string[];
  onPreview?: () => void;
  readOnly?: boolean;
  height?: string;
  rows?: number;
}

/** 轻量 SQL 编辑器：语法高亮 + 自动补全（表名/字段名/参数占位符）+ Ctrl/Cmd+Enter 预览 */
export default function SqlEditor({
  value,
  onChange,
  schemaNames = [],
  tableNames = [],
  columnNames = [],
  onPreview,
  readOnly,
  height = '240px',
  rows,
}: SqlEditorProps) {
  const [showComp, setShowComp] = useState(false);
  const [compItems, setCompItems] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const highlight = useMemo(() => tokenize(value || ''), [value]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const lineHeight = 21;

  const applyCompletion = (word: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const before = value.slice(0, start);
    const m = /[\w$]{1,40}$/.exec(before);
    const wl = m ? m[0].length : 0;
    const after = value.slice(start);
    const next = before.slice(0, before.length - wl) + word + after;
    onChange(next);
    const nc = before.length - wl + word.length;
    requestAnimationFrame(() => {
      ta.setSelectionRange(nc, nc);
      ta.focus();
    });
    setShowComp(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  };

  const handleScroll = () => {
    const ta = taRef.current, ov = overlayRef.current;
    if (ta && ov) {
      ov.scrollTop = ta.scrollTop;
      ov.scrollLeft = ta.scrollLeft;
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onPreview?.();
      return;
    }
    const ta = taRef.current;
    if (showComp && e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, compItems.length - 1)); return; }
    if (showComp && e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
    if (showComp && (e.key === 'Enter' || e.key === 'Tab')) {
      if (compItems[cursor]) { e.preventDefault(); applyCompletion(compItems[cursor]); return; }
    }
    if (showComp && e.key === 'Escape') { setShowComp(false); return; }
    // 计算建议列表
    if (!readOnly && ta) {
      const start = ta.selectionStart;
      const before = value.slice(0, start).toUpperCase();
      const m = /[\w$]{1,40}$/.exec(before);
      const word = m ? m[0].toUpperCase() : '';
      if (word) {
        const pool = new Set<string>([
          ...tableNames.map((t) => t.toUpperCase()),
          ...columnNames.map((c) => c.toUpperCase()),
          ...schemaNames.map((s) => s.toUpperCase()),
        ]);
        const items = [...pool].filter((it) => it.startsWith(word)).slice(0, 8);
        if (items.length && (items.some((it) => it !== word))) {
          // 占位符提示
          if (word.startsWith('${')) items.unshift('${param}');
          setCompItems(items);
          setCursor(0);
          const r = ta.getBoundingClientRect();
          const lineNo = (value.slice(0, start).match(/\n/g) || []).length;
          const col = start - (value.lastIndexOf('\n', start - 1) + 1);
          void col;
          setPos({ top: lineNo * lineHeight + 4, left: 8 });
          void r;
          setShowComp(true);
        } else {
          setShowComp(false);
        }
      } else {
        setShowComp(false);
      }
    }
  };

  useEffect(() => {
    if (showComp) document.addEventListener('click', () => setShowComp(false));
    return () => document.removeEventListener('click', () => setShowComp(false));
  }, [showComp]);

  return (
    <div className="relative w-full overflow-hidden rounded-md border border-gray-300 bg-gray-50">
      <div className="pointer-events-none absolute inset-0 overflow-hidden px-3 font-mono text-[13px] leading-[21px] whitespace-pre text-transparent" ref={overlayRef}>
        <div dangerouslySetInnerHTML={{ __html: highlight + '\n' }} />
      </div>
      <textarea
        ref={taRef}
        value={value}
        readOnly={readOnly}
        rows={rows || Math.max(8, Math.ceil(parseInt(height, 10) / lineHeight))}
        onChange={handleChange}
        onScroll={handleScroll}
        onKeyDown={handleKey}
        spellCheck={false}
        className="relative z-10 w-full resize-y bg-transparent px-3 py-2 font-mono text-[13px] leading-[21px] text-gray-800 outline-none"
        style={readOnly ? { background: 'transparent' } : {}}
      />
      {showComp && compItems.length > 0 && (
        <div
          className="absolute z-20 max-h-40 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg"
          style={{ top: pos.top, left: pos.left }}
        >
          {compItems.map((item, i) => (
            <div
              key={item}
              onMouseDown={(e) => { e.preventDefault(); applyCompletion(item); }}
              onMouseEnter={() => setCursor(i)}
              className={`cursor-pointer px-2 py-0.5 font-mono text-sm ${i === cursor ? 'bg-blue-100' : ''}`}
            >
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}