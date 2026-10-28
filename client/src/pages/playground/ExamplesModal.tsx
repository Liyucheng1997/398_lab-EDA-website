import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronRight, RefreshCw, Search } from 'lucide-react';
import type { ExampleSummary } from '@webeda/shared';
import { api } from '../../lib/api';
import { Modal } from '../../ui/Modal';
import { CATEGORY_LABEL, groupExamples } from './examples';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
}

/** 示例库：按分类分组，可搜索 */
export function ExamplesModal({ open, onClose, onPick }: Props) {
  const [list, setList] = useState<ExampleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [reload, setReload] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => searchRef.current?.focus());
    if (list && !error) return;
    let alive = true;
    setError(null);
    api
      .examples()
      .then((l) => alive && setList(Array.isArray(l) ? l : []))
      .catch((e: Error) => alive && setError(e.message || '加载失败'));
    return () => {
      alive = false;
    };
  }, [open, reload]);

  const groups = useMemo(() => groupExamples(list ?? [], query), [list, query]);
  const firstId = groups[0]?.items[0]?.id;

  return (
    <Modal open={open} title="示例" onClose={onClose} width={720}>
      <div className="pg-ex">
        <div className="pg-ex-search">
          <Search size={15} strokeWidth={1.75} />
          <input
            ref={searchRef}
            value={query}
            placeholder="搜索示例（标题、描述、分类）"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && firstId) onPick(firstId);
            }}
          />
        </div>
        <div className="pg-ex-list">
          {error ? (
            <div className="empty">
              <BookOpen size={34} strokeWidth={1.4} />
              <span>示例加载失败：{error}</span>
              <button className="btn btn-sm" onClick={() => setReload((n) => n + 1)}>
                <RefreshCw size={14} strokeWidth={1.75} />
                重试
              </button>
            </div>
          ) : !list ? (
            <div className="empty">
              <div className="spinner" />
            </div>
          ) : groups.length === 0 ? (
            <div className="empty">
              <Search size={34} strokeWidth={1.4} />
              <span>{query ? '没有匹配的示例' : '暂无示例'}</span>
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.category} className="pg-ex-group">
                <div className="pg-ex-group-title">
                  {CATEGORY_LABEL[g.category] ?? g.category}
                  <span className="badge">{g.items.length}</span>
                </div>
                {g.items.map((e) => (
                  <button key={e.id} className="pg-ex-row" onClick={() => onPick(e.id)}>
                    <span className="pg-ex-ico">{(e.title || e.id).slice(0, 1).toUpperCase()}</span>
                    <span className="pg-ex-text">
                      <b>{e.title}</b>
                      <small>{e.description}</small>
                    </span>
                    <ChevronRight size={16} strokeWidth={1.75} className="pg-ex-chev" />
                  </button>
                ))}
              </section>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
