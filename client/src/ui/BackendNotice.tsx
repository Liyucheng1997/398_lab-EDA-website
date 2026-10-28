import { useEffect, useState } from 'react';
import { ServerOff, X } from 'lucide-react';
import { apiUrl } from '../lib/config';

const REPO_URL = 'https://github.com/Liyucheng1997/398_lab-EDA-website';

/**
 * 连不上后端时（例如部署在 GitHub Pages 的纯静态站点）在底部提示：
 * 仿真、综合等功能需要运行 WebEDA 服务端。
 */
export function BackendNotice() {
  const [offline, setOffline] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('webeda.backendNotice') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    fetch(apiUrl('/api/tools'), { signal: ctrl.signal })
      .then((r) => {
        // 静态托管会对未知路径返回 404 页面（HTML），不能只看 r.ok
        const json = r.headers.get('content-type')?.includes('application/json');
        if (!r.ok || !json) setOffline(true);
      })
      .catch(() => setOffline(true))
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, []);

  if (!offline || dismissed) return null;
  return (
    <div className="backend-notice" role="status">
      <ServerOff size={16} strokeWidth={1.75} />
      <span>
        当前页面没有连接到 WebEDA 服务端，可以浏览界面和编辑代码，但仿真、综合、布局布线等功能不可用。
        请按{' '}
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          README
        </a>{' '}
        在本机运行 <code>npm run dev</code>。
      </span>
      <button
        className="icon-btn"
        aria-label="关闭提示"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem('webeda.backendNotice', '1');
          } catch {
            /* ignore */
          }
        }}
      >
        <X size={15} strokeWidth={1.75} />
      </button>
    </div>
  );
}
