import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  Crown,
  Database,
  FileCode2,
  FileCog,
  FileQuestion,
  FileText,
  FlaskConical,
  FolderInput,
  MoreHorizontal,
  Network,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { FileRole, HierarchyNode, ProjectSettings, SourceFile } from '@webeda/shared';
import { ContextMenu, type MenuEntry } from './ContextMenu';
import { HierarchyTree } from '../../features/schematic';
import { groupFiles, modulesByFile, roleOf, ROLE_LABEL, type SourceGroupKey } from './model';

export interface SourcesPanelProps {
  files: SourceFile[];
  settings: ProjectSettings;
  activeFile?: string;
  onOpen: (name: string) => void;
  onAdd: (role?: FileRole) => void;
  onImport: (files: FileList) => void;
  onRename: (name: string) => void;
  onDelete: (name: string) => void;
  onSetTop: (module: string) => void;
  onSetSimTop: (module: string) => void;
  onSetConstraint: (name: string) => void;
  onSetRole: (name: string, role: FileRole) => void;
  hierarchy: HierarchyNode | null;
  hierarchyLoading: boolean;
  hierarchyStale: boolean;
  onRunElaborate: () => void;
  onSelectHierarchy: (node: HierarchyNode) => void;
  selectedModule?: string;
}

const GROUP_ICON: Record<SourceGroupKey, ReactNode> = {
  design: <FileCode2 size={14} strokeWidth={1.75} />,
  constraint: <FileCog size={14} strokeWidth={1.75} />,
  testbench: <FlaskConical size={14} strokeWidth={1.75} />,
  memory: <Database size={14} strokeWidth={1.75} />,
  other: <FileQuestion size={14} strokeWidth={1.75} />,
};

const ROLES: FileRole[] = ['design', 'include', 'constraint', 'testbench', 'memory', 'other'];

const ACCEPT = '.v,.sv,.vh,.svh,.vl,.pcf,.lpf,.xdc,.cst,.sdc,.hex,.mem,.coe,.mif,.txt,.md,.ys,.tcl';

/** 源文件面板：按角色分组的文件树 + 设计层次 */
export function SourcesPanel(p: SourcesPanelProps) {
  const [view, setView] = useState<'files' | 'hierarchy'>('files');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => groupFiles(p.files), [p.files]);
  const mods = useMemo(() => modulesByFile(p.files), [p.files]);

  const fileMenu = (f: SourceFile): MenuEntry[] => {
    const role = roleOf(f);
    const modules = mods.get(f.name) ?? [];
    const items: MenuEntry[] = [{ label: '打开', icon: <FileText size={14} strokeWidth={1.75} />, onClick: () => p.onOpen(f.name) }];
    if ((role === 'design' || role === 'include') && modules.length) {
      items.push({ type: 'sep' });
      for (const m of modules.slice(0, 12))
        items.push({
          label: modules.length > 1 ? `设为顶层：${m}` : '设为顶层',
          icon: <Crown size={14} strokeWidth={1.75} />,
          disabled: p.settings.top === m,
          onClick: () => p.onSetTop(m),
        });
    }
    if (role === 'testbench' && modules.length) {
      items.push({ type: 'sep' });
      for (const m of modules.slice(0, 12))
        items.push({
          label: modules.length > 1 ? `设为仿真顶层：${m}` : '设为仿真顶层',
          icon: <Crown size={14} strokeWidth={1.75} />,
          disabled: p.settings.simTop === m,
          onClick: () => p.onSetSimTop(m),
        });
    }
    if (role === 'constraint') {
      items.push({ type: 'sep' });
      items.push({
        label: '设为当前约束文件',
        icon: <Crown size={14} strokeWidth={1.75} />,
        disabled: p.settings.constraintFile === f.name,
        onClick: () => p.onSetConstraint(f.name),
      });
    }
    items.push({ type: 'sep' }, { type: 'header', label: '文件类型' });
    for (const r of ROLES)
      items.push({
        label: ROLE_LABEL[r],
        icon: r === role ? <span className="st-check">✓</span> : undefined,
        disabled: r === role,
        onClick: () => p.onSetRole(f.name, r),
      });
    items.push(
      { type: 'sep' },
      { label: '重命名…', icon: <Pencil size={14} strokeWidth={1.75} />, onClick: () => p.onRename(f.name) },
      { label: '删除', icon: <Trash2 size={14} strokeWidth={1.75} />, danger: true, onClick: () => p.onDelete(f.name) },
    );
    return items;
  };

  const openMenu = (e: React.MouseEvent, f: SourceFile) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items: fileMenu(f) });
  };

  const isTopFile = (f: SourceFile) => {
    const m = mods.get(f.name) ?? [];
    const role = roleOf(f);
    if (role === 'design' || role === 'include') return !!p.settings.top && m.includes(p.settings.top);
    if (role === 'testbench') return !!p.settings.simTop && m.includes(p.settings.simTop);
    if (role === 'constraint') return p.settings.constraintFile === f.name;
    return false;
  };

  return (
    <div className="panel st-sources">
      <div className="panel-header st-panel-header">
        <div className="seg st-seg-sm">
          <button className={view === 'files' ? 'active' : ''} onClick={() => setView('files')}>
            源文件
          </button>
          <button className={view === 'hierarchy' ? 'active' : ''} onClick={() => setView('hierarchy')}>
            层次
          </button>
        </div>
        <span className="spacer" />
        {view === 'files' ? (
          <>
            <button className="icon-btn st-icon-sm" title="导入本地文件" onClick={() => fileInput.current?.click()}>
              <FolderInput size={15} strokeWidth={1.75} />
            </button>
            <button className="icon-btn st-icon-sm" title="添加源文件" onClick={() => p.onAdd()}>
              <Plus size={16} strokeWidth={1.75} />
            </button>
          </>
        ) : (
          <button className="icon-btn st-icon-sm" title="重新运行 RTL 分析" onClick={p.onRunElaborate} disabled={p.hierarchyLoading}>
            <Network size={15} strokeWidth={1.75} />
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            if (e.target.files?.length) p.onImport(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <div className="panel-body st-sources-body">
        {view === 'files' ? (
          p.files.length === 0 ? (
            <div className="empty">
              <FileCode2 size={34} strokeWidth={1.4} />
              <span>工程里还没有文件</span>
              <button className="btn btn-sm btn-primary" onClick={() => p.onAdd()}>
                添加源文件
              </button>
            </div>
          ) : (
            groups
              .filter((g) => g.files.length > 0 || g.key === 'design' || g.key === 'constraint' || g.key === 'testbench')
              .map((g) => (
                <div key={g.key} className="st-group">
                  <div className="st-group-head" onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}>
                    <ChevronDown size={13} strokeWidth={2} className={`st-chev${collapsed[g.key] ? ' st-chev-closed' : ''}`} />
                    <span className="st-group-label">{g.label}</span>
                    <span className="st-group-count">{g.files.length}</span>
                    <span className="spacer" />
                    <button
                      className="icon-btn st-icon-xs st-group-add"
                      title={`添加${g.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        p.onAdd(g.key === 'other' ? 'other' : (g.key as FileRole));
                      }}
                    >
                      <Plus size={13} strokeWidth={1.75} />
                    </button>
                  </div>
                  {!collapsed[g.key] &&
                    (g.files.length === 0 ? (
                      <div className="st-group-empty">（空）</div>
                    ) : (
                      g.files.map((f) => {
                        const top = isTopFile(f);
                        const modules = mods.get(f.name) ?? [];
                        return (
                          <div
                            key={f.name}
                            className={`st-file${p.activeFile === f.name ? ' active' : ''}${top ? ' st-file-top' : ''}`}
                            onClick={() => p.onOpen(f.name)}
                            onContextMenu={(e) => openMenu(e, f)}
                            title={modules.length ? `${f.name}\n模块：${modules.join(', ')}` : f.name}
                          >
                            <span className="st-file-ico">{GROUP_ICON[g.key]}</span>
                            <span className="st-file-name">
                              {modules.length > 0 && <span className="st-file-mod">{modules[0]}</span>}
                              <span className={modules.length ? 'st-file-path' : ''}>
                                {modules.length ? `(${f.name})` : f.name}
                              </span>
                            </span>
                            {top && (
                              <span className="st-top-mark" title={roleOf(f) === 'constraint' ? '当前约束文件' : '顶层'}>
                                <Crown size={12} strokeWidth={1.75} />
                              </span>
                            )}
                            <button className="icon-btn st-icon-xs st-file-more" title="更多操作" onClick={(e) => openMenu(e, f)}>
                              <MoreHorizontal size={14} strokeWidth={1.75} />
                            </button>
                          </div>
                        );
                      })
                    ))}
                </div>
              ))
          )
        ) : p.hierarchy ? (
          <>
            {p.hierarchyStale && (
              <div className="st-note">
                设计已修改，层次可能过期
                <button className="btn btn-sm btn-ghost" onClick={p.onRunElaborate} disabled={p.hierarchyLoading}>
                  刷新
                </button>
              </div>
            )}
            <HierarchyTree root={p.hierarchy} selected={p.selectedModule} onSelect={(node) => p.onSelectHierarchy(node)} />
          </>
        ) : (
          <div className="empty">
            {p.hierarchyLoading ? (
              <>
                <div className="spinner" />
                <span>正在分析设计层次…</span>
              </>
            ) : (
              <>
                <Network size={34} strokeWidth={1.4} />
                <span>运行 RTL 分析后显示设计层次</span>
                <button className="btn btn-sm btn-primary" onClick={p.onRunElaborate}>
                  运行 RTL 分析
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
