import { useEffect, useState } from 'react';

export interface ArtifactState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * 按 (jobId, name) 加载任务产物；参数变化时重新加载，过期请求的结果被丢弃。
 * jobId 或 name 为空时返回空状态。
 */
export function useArtifact<T>(
  jobId: string | null | undefined,
  name: string | null | undefined,
  loader: (jobId: string, name: string) => Promise<T>,
): ArtifactState<T> {
  const [state, setState] = useState<ArtifactState<T> & { key: string }>({ data: null, loading: false, error: null, key: '' });
  const key = jobId && name ? `${jobId}/${name}` : '';

  useEffect(() => {
    if (!jobId || !name) {
      setState({ data: null, loading: false, error: null, key: '' });
      return;
    }
    let alive = true;
    setState((s) => ({ data: s.key === key ? s.data : null, loading: true, error: null, key }));
    loader(jobId, name).then(
      (data) => alive && setState({ data, loading: false, error: null, key }),
      (e: Error) => alive && setState({ data: null, loading: false, error: e.message || '加载失败', key }),
    );
    return () => {
      alive = false;
    };
    // loader 视为稳定（传入模块级函数）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, name, key]);

  if (state.key !== key) return { data: null, loading: !!key, error: null };
  return { data: state.data, loading: state.loading, error: state.error };
}
