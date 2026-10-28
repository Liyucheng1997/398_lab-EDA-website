import { Link, useParams } from 'react-router-dom';
import { FolderX, RefreshCw } from 'lucide-react';
import { useProjectDoc } from './useProjectDoc';
import { Workbench } from './Workbench';
import './studio.css';

/** /studio/:id —— 类 Vivado 的 FPGA 工程界面 */
export default function StudioPage() {
  const { id } = useParams<{ id: string }>();
  const doc = useProjectDoc(id);

  if (doc.load.status === 'loading' || (doc.load.status === 'ready' && !doc.project)) {
    return (
      <div className="page-loading st-page-state">
        <div className="spinner" />
        <span className="muted">正在打开工程…</span>
      </div>
    );
  }
  if (doc.load.status === 'notfound') {
    return (
      <div className="st-page-state">
        <div className="card st-state-card">
          <FolderX size={40} strokeWidth={1.4} className="st-state-ico" />
          <h2>工程不存在</h2>
          <p className="muted">链接可能有误，或工程已被删除。</p>
          <Link className="btn btn-primary" to="/studio">
            返回工程列表
          </Link>
        </div>
      </div>
    );
  }
  if (doc.load.status === 'error') {
    return (
      <div className="st-page-state">
        <div className="card st-state-card">
          <FolderX size={40} strokeWidth={1.4} className="st-state-ico" />
          <h2>无法打开工程</h2>
          <p className="muted">{doc.load.message}</p>
          <div className="st-state-actions">
            <Link className="btn" to="/studio">
              返回工程列表
            </Link>
            <button className="btn btn-primary" onClick={() => void doc.reload()}>
              <RefreshCw size={14} strokeWidth={1.75} />
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }
  return <Workbench key={doc.project!.id} doc={doc} />;
}
