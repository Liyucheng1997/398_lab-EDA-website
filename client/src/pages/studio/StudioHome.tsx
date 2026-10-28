import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CircuitBoard, FileCode2, FolderOpen, Moon, Plus, RefreshCw, Search, Sun, Trash2 } from 'lucide-react';
import type { ProjectSummary } from '@webeda/shared';
import { getBoard, getDevice } from '@webeda/shared';
import { api } from '../../lib/api';
import { useTheme } from '../../lib/theme';
import { toast } from '../../ui/toast';
import { ConfirmModal } from './FileDialogs';
import { NewProjectWizard } from './NewProjectWizard';
import { formatDateTime, formatRelative } from './reports';
import { useNow } from './useStudioUi';
import './studio.css';

/** /studio —— 工程列表与新建工程向导 */
export default function StudioHome() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const templateId = params.get('template');
  const [theme, setTheme] = useTheme();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [wizardOpen, setWizardOpen] = useState(!!templateId);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const now = useNow(60000);

  useEffect(() => {
    document.title = 'Studio · WebEDA';
  }, []);

  useEffect(() => {
    if (templateId) setWizardOpen(true);
  }, [templateId]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProjects(await api.projects());
    } catch (e) {
      setError((e as Error).message);
      setProjects((p) => p ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!projects) return [];
    if (!q) return projects;
    return projects.filter((p) => {
      const dev = getDevice(p.device);
      const board = getBoard(p.board);
      return [p.name, p.description, dev?.name, dev?.partNumber, board?.name].some((s) => s?.toLowerCase().includes(q));
    });
  }, [projects, query]);

  const closeWizard = () => {
    setWizardOpen(false);
    if (templateId) {
      const next = new URLSearchParams(params);
      next.delete('template');
      setParams(next, { replace: true });
    }
  };

  const confirmDelete = async () => {
    const p = deleting;
    if (!p) return;
    setDeleting(null);
    try {
      await api.deleteProject(p.id);
      setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
      toast(`已删除「${p.name}」`);
    } catch (e) {
      toast(`删除失败：${(e as Error).message}`, 'error');
    }
  };

  return (
    <div className="st-home">
      <header className="topbar">
        <Link to="/" className="logo">
          <span className="logo-mark">W</span>
          <span className="logo-text">
            <b>WebEDA</b>
            <small>Studio</small>
          </span>
        </Link>
        <span className="spacer" />
        <Link to="/playground" className="btn btn-sm btn-ghost">
          Playground
        </Link>
        <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="切换深色模式" aria-label="切换主题">
          {theme === 'dark' ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}
        </button>
      </header>
      <main className="st-home-main">
        <div className="st-home-head">
          <div>
            <div className="st-eyebrow">FPGA STUDIO</div>
            <h1>我的工程</h1>
            <p className="st-home-sub">像 Vivado 一样管理 FPGA 工程：RTL 分析、综合、布局布线、生成比特流，并在虚拟开发板上运行。</p>
          </div>
          <button className="btn btn-primary st-home-new" onClick={() => setWizardOpen(true)}>
            <Plus size={16} strokeWidth={2} />
            新建工程
          </button>
        </div>

        <section className="card st-home-card">
          <div className="st-home-toolbar">
            <div className="st-search">
              <Search size={15} strokeWidth={1.75} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索工程、器件或板卡" aria-label="搜索工程" />
            </div>
            <span className="st-flex1" />
            {projects && <span className="muted st-hide-sm">{projects.length} 个工程</span>}
            <button className="icon-btn" title="刷新" onClick={() => void load()}>
              <RefreshCw size={15} strokeWidth={1.75} />
            </button>
          </div>

          {projects === null ? (
            <div className="st-home-state">
              <div className="spinner" />
            </div>
          ) : error && !projects.length ? (
            <div className="empty st-home-state">
              <span>无法加载工程列表：{error}</span>
              <button className="btn btn-sm" onClick={() => void load()}>
                重试
              </button>
            </div>
          ) : !projects.length ? (
            <div className="empty st-home-state">
              <CircuitBoard size={34} strokeWidth={1.4} />
              <span>还没有工程，新建一个开始吧</span>
              <button className="btn btn-primary btn-sm" onClick={() => setWizardOpen(true)}>
                新建工程
              </button>
            </div>
          ) : !filtered.length ? (
            <div className="empty st-home-state">
              <Search size={34} strokeWidth={1.4} />
              <span>没有匹配“{query}”的工程</span>
            </div>
          ) : (
            <div className="st-plist" role="list">
              <div className="st-prow st-prow-head" aria-hidden>
                <span>名称</span>
                <span>器件</span>
                <span className="st-hide-sm">板卡</span>
                <span className="st-hide-sm">文件</span>
                <span className="st-hide-sm">更新时间</span>
                <span />
              </div>
              {filtered.map((p) => {
                const dev = getDevice(p.device);
                const board = getBoard(p.board);
                return (
                  <div
                    key={p.id}
                    className="st-prow"
                    role="listitem"
                    tabIndex={0}
                    onClick={() => navigate(`/studio/${p.id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/studio/${p.id}`)}
                  >
                    <span className="st-prow-name">
                      <span className="st-prow-ico">
                        <CircuitBoard size={17} strokeWidth={1.75} />
                      </span>
                      <span className="st-prow-text">
                        <b>{p.name}</b>
                        {p.description && <small>{p.description}</small>}
                      </span>
                    </span>
                    <span>
                      <span className={`st-tag ${dev?.pnr ? '' : 'st-tag-warn'}`} title={dev ? `${dev.name}${dev.pnr ? '' : '（仅综合）'}` : p.device}>
                        {dev?.partNumber ?? p.device}
                      </span>
                    </span>
                    <span className="st-hide-sm muted">{board?.name ?? (p.board || '—')}</span>
                    <span className="st-hide-sm muted tabular">
                      <FileCode2 size={13} strokeWidth={1.75} className="st-inline-ico" />
                      {p.fileCount}
                    </span>
                    <span className="st-hide-sm muted" title={formatDateTime(p.updatedAt)}>
                      {formatRelative(p.updatedAt, now)}
                    </span>
                    <span className="st-prow-actions">
                      <button
                        className="icon-btn"
                        title="打开"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/studio/${p.id}`);
                        }}
                      >
                        <FolderOpen size={16} strokeWidth={1.75} />
                      </button>
                      <button
                        className="icon-btn st-danger-hover"
                        title="删除"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleting(p);
                        }}
                      >
                        <Trash2 size={16} strokeWidth={1.75} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <NewProjectWizard
        open={wizardOpen}
        templateId={templateId}
        onClose={closeWizard}
        onCreated={(p) => {
          setWizardOpen(false);
          navigate(`/studio/${p.id}`, { replace: !!templateId });
        }}
      />
      <ConfirmModal
        open={!!deleting}
        title={`删除工程「${deleting?.name ?? ''}」？`}
        message="工程中的所有文件和运行记录都会被删除，此操作无法撤销。"
        confirmText="删除"
        danger
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
