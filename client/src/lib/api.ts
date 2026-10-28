import type {
  Example,
  ExampleSummary,
  GateNetlist,
  JobEvent,
  JobInfo,
  JobRequest,
  JobStatus,
  Playground,
  PlaygroundInput,
  PlacementInfo,
  Project,
  ProjectInput,
  ProjectSummary,
  ToolInfo,
} from '@webeda/shared';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  tools: () => request<ToolInfo[]>('GET', '/api/tools'),
  examples: () => request<ExampleSummary[]>('GET', '/api/examples'),
  example: (id: string) => request<Example>('GET', `/api/examples/${encodeURIComponent(id)}`),

  createPlayground: (input: PlaygroundInput & { forkedFrom?: string }) => request<Playground>('POST', '/api/playgrounds', input),
  getPlayground: (id: string) => request<Playground>('GET', `/api/playgrounds/${id}`),
  updatePlayground: (id: string, input: PlaygroundInput) => request<Playground>('PUT', `/api/playgrounds/${id}`, input),

  projects: () => request<ProjectSummary[]>('GET', '/api/projects'),
  createProject: (input: ProjectInput) => request<Project>('POST', '/api/projects', input),
  getProject: (id: string) => request<Project>('GET', `/api/projects/${id}`),
  updateProject: (id: string, input: ProjectInput) => request<Project>('PUT', `/api/projects/${id}`, input),
  deleteProject: (id: string) => request<{ ok: true }>('DELETE', `/api/projects/${id}`),

  createJob: (req: JobRequest) => request<{ id: string }>('POST', '/api/jobs', req),
  getJob: (id: string) => request<JobInfo>('GET', `/api/jobs/${id}`),
  cancelJob: (id: string) => request<{ ok: true }>('POST', `/api/jobs/${id}/cancel`),
  artifactUrl: (jobId: string, name: string, download = false) =>
    `/api/jobs/${jobId}/artifacts/${encodeURIComponent(name)}${download ? '?download' : ''}`,
  artifactText: async (jobId: string, name: string) => {
    const res = await fetch(api.artifactUrl(jobId, name));
    if (!res.ok) throw new Error(`无法下载产物 ${name}`);
    return res.text();
  },
  artifactJson: async <T,>(jobId: string, name: string): Promise<T> => JSON.parse(await api.artifactText(jobId, name)) as T,
  gateNetlist: (jobId: string, name: string) => api.artifactJson<GateNetlist>(jobId, name),
  placement: (jobId: string, name: string) => api.artifactJson<PlacementInfo>(jobId, name),
};

export interface JobHandlers {
  onLog?: (ev: Extract<JobEvent, { type: 'log' }>) => void;
  onStatus?: (status: JobStatus, stage?: string) => void;
}

export interface RunningJob {
  id: string;
  /** 任务结束（成功/失败/取消）时 resolve 最终 JobInfo；网络错误时 reject */
  done: Promise<JobInfo>;
  cancel: () => Promise<void>;
}

/** 提交任务并订阅 SSE 事件流 */
export async function startJob(req: JobRequest, handlers: JobHandlers = {}): Promise<RunningJob> {
  const { id } = await api.createJob(req);
  let es: EventSource | null = null;
  const done = new Promise<JobInfo>((resolve, reject) => {
    es = new EventSource(`/api/jobs/${id}/events`);
    let finished = false;
    es.addEventListener('log', (e) => handlers.onLog?.(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('status', (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as Extract<JobEvent, { type: 'status' }>;
      handlers.onStatus?.(ev.status, ev.stage);
    });
    es.addEventListener('end', (e) => {
      finished = true;
      es?.close();
      resolve((JSON.parse((e as MessageEvent).data) as Extract<JobEvent, { type: 'end' }>).job);
    });
    es.onerror = () => {
      if (finished) return;
      es?.close();
      // SSE 断开：退化为轮询
      const poll = async () => {
        try {
          const info = await api.getJob(id);
          if (info.status === 'succeeded' || info.status === 'failed' || info.status === 'cancelled') resolve(info);
          else setTimeout(poll, 800);
        } catch (err) {
          reject(err);
        }
      };
      poll();
    };
  });
  return {
    id,
    done,
    cancel: async () => {
      await api.cancelJob(id).catch(() => {});
    },
  };
}
