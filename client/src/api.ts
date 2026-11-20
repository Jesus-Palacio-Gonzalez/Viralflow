import type {
  AnalysisDTO,
  AnalysisMode,
  Catalog,
  FormatPreset,
  Niche,
  Project,
  Clip,
  Music,
  ProjectContent,
  RenderOptions,
  RenderState,
  ScanParams,
  ScanSummary,
  ScriptDTO,
  ScriptParams,
  ScriptPatch,
  Status,
  Term,
  TreeNode,
  Video,
  VideoFilters,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

const OFFLINE = 'No se pudo conectar con el servidor. Revisa que esté corriendo (npm run dev).';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError(OFFLINE, 'NETWORK');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error?.message ?? OFFLINE, data?.error?.code ?? 'ERROR');
  return data as T;
}

function qs(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  status: () => request<Status>('/status'),
  catalog: () => request<Catalog>('/catalog'),
  formats: () => request<FormatPreset[]>('/formats'),

  niches: (days: number) => request<Niche[]>(`/niches${qs({ days })}`),
  terms: (days: number) => request<Term[]>(`/niches/terms${qs({ days })}`),

  videos: (f: VideoFilters) =>
    request<{ total: number; videos: Video[] }>(
      `/videos${qs({
        days: f.days,
        nicheId: f.nicheId,
        duration: f.duration,
        minScore: f.minScore,
        q: f.q,
        sort: f.sort,
        limit: f.limit,
      })}`,
    ),

  estimate: (params: ScanParams) => request<{ units: number; remaining: number }>('/scans/estimate', json('POST', params)),
  scan: (params: ScanParams) => request<ScanSummary>('/scans', json('POST', params)),

  seedDemo: () => request<{ videos: number }>('/demo/seed', json('POST')),
  clearDemo: () => request<{ remaining: number }>('/demo', json('DELETE')),

  projects: () => request<Project[]>('/projects'),
  createProject: (body: { name: string; videoId?: string; nicheId?: number; platforms: string[] }) =>
    request<Project>('/projects', json('POST', body)),
  project: (id: number) => request<{ project: Project; tree: TreeNode[] }>(`/projects/${id}`),
  updateProject: (id: number, patch: { stage?: string; name?: string }) =>
    request<Project>(`/projects/${id}`, json('PATCH', patch)),
  content: (id: number) => request<ProjectContent>(`/projects/${id}/content`),
  analyze: (id: number, mode: AnalysisMode) => request<AnalysisDTO>(`/projects/${id}/analyze`, json('POST', { mode })),
  generateScript: (id: number, params: ScriptParams) => request<ScriptDTO>(`/projects/${id}/script`, json('POST', params)),
  render: (id: number) => request<RenderState>(`/projects/${id}/render`),
  startRender: (id: number, options: Partial<RenderOptions>) => request<RenderState>(`/projects/${id}/render`, json('POST', options)),
  cancelRender: (id: number) => request<{ cancelled: boolean }>(`/projects/${id}/render/cancel`, json('POST', {})),
  deleteClip: (id: number, n: number) => request<void>(`/projects/${id}/clips/${n}`, json('DELETE')),
  deleteMusic: (id: number) => request<void>(`/projects/${id}/music`, json('DELETE')),
  updateScript: (id: number, patch: ScriptPatch) => request<ScriptDTO>(`/projects/${id}/script`, json('PATCH', patch)),
  deleteProject: (id: number, deleteFiles: boolean) =>
    request<void>(`/projects/${id}${qs({ deleteFiles: deleteFiles ? '1' : '0' })}`, json('DELETE')),
};

/** Subida con progreso (fetch no informa del avance). El cuerpo viaja crudo: sin multipart. */
export function uploadFile<T>(path: string, file: File, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api${path}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(OFFLINE, 'NETWORK'));
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // respuesta sin cuerpo JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(data?.error?.message ?? 'La subida falló.', data?.error?.code ?? 'ERROR'));
    };
    xhr.send(file);
  });
}

export const uploadClip = (id: number, n: number, file: File, onProgress: (f: number) => void) => uploadFile<Clip>(`/projects/${id}/clips/${n}`, file, onProgress);
export const uploadMusic = (id: number, file: File, onProgress: (f: number) => void) => uploadFile<Music>(`/projects/${id}/music`, file, onProgress);
