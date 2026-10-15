// Typed client for the knowledge-base REST API (specs/001-knowledge-base/contracts/rest-api.md).
// DTO types are imported type-only so zod never lands in the client bundle.
import type {
  ConflictView,
  DiscoveryRunView,
  JobCard,
  JobSourceType,
  JobsQuery,
  Preferences,
  SourceView,
  FactKind,
  FactRevisionView,
  FactView,
  PersonalFacts,
  ProfileSourceView,
  RenderItem,
  RenderRequest,
  ResumeDetail,
  ResumeDraft,
  ResumeSummary,
  SyncRunView,
} from "@autoapply/shared";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function toError(res: Response): Promise<ApiRequestError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
    if (body?.error) {
      return new ApiRequestError(res.status, body.error.code ?? "http_error", body.error.message ?? res.statusText, body.error.details);
    }
  } catch {
    // non-JSON body
  }
  return new ApiRequestError(res.status, "http_error", `${res.status} ${res.statusText}`);
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body && typeof init.body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { cache: "no-store", ...init, headers });
  } catch {
    throw new ApiRequestError(0, "network", `API indisponível (${API_URL})`);
  }
  if (!res.ok) throw await toError(res);
  return res;
}

/** JSON request; throws ApiRequestError carrying the API's message. Empty bodies resolve to undefined. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await request(path, init);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

function qs(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ---------- resumes ----------

export const resumes = {
  list: () => api<ResumeSummary[]>("/kb/resumes"),
  get: (id: string) => api<ResumeDetail>(`/kb/resumes/${id}`),
  fileUrl: (id: string) => `${API_URL}/kb/resumes/${id}/file`,
  upload: (form: FormData) => api<{ id: string; status: "uploaded" }>("/kb/resumes", { method: "POST", body: form }),
  saveDraft: (id: string, draft: ResumeDraft) => api<ResumeDetail>(`/kb/resumes/${id}/draft`, json("PUT", draft)),
  retry: (id: string, mode: "text" | "vision") => api<unknown>(`/kb/resumes/${id}/retry`, json("POST", { mode })),
  manual: (id: string) => api<unknown>(`/kb/resumes/${id}/manual`, json("POST")),
  confirm: (id: string, acceptFlagged: string[]) =>
    api<{ created: number; updated: number; conflicts: number }>(`/kb/resumes/${id}/confirm`, json("POST", { acceptFlagged })),
  discard: (id: string) => api<unknown>(`/kb/resumes/${id}/discard`, json("POST")),
};

// ---------- facts ----------

export interface FactsFilter {
  kind?: string;
  origin?: string;
  verified?: "true" | "false";
  conflict?: "true" | "false";
  status?: "active" | "archived";
  q?: string;
}

export type FactDetail = FactView & { revisions: FactRevisionView[] };
export type BulkAction = "verify" | "unverify" | "archive" | "restore";

export const facts = {
  list: (filter: FactsFilter = {}) => api<FactView[]>(`/kb/facts${qs({ ...filter })}`),
  get: (id: string) => api<FactDetail>(`/kb/facts/${id}`),
  patch: (id: string, body: { value?: unknown; verified?: boolean }) => api<FactView>(`/kb/facts/${id}`, json("PATCH", body)),
  create: (kind: FactKind, value: unknown) => api<FactView>("/kb/facts", json("POST", { kind, value })),
  bulk: (ids: string[], action: BulkAction) => api<{ updated: number }>("/kb/facts/bulk", json("POST", { ids, action })),
};

// ---------- personal ----------

export const personal = {
  get: () => api<PersonalFacts>("/kb/personal"),
  put: (body: PersonalFacts) => api<PersonalFacts>("/kb/personal", json("PUT", body)),
};

// ---------- conflicts ----------

export type ResolveBody =
  | { strategy: "choose"; chosenIndex: number }
  | { strategy: "edit"; value: unknown }
  | { strategy: "split" }
  | { strategy: "merge" }
  | { strategy: "keep_separate" };

export const conflicts = {
  list: (status: "open" | "resolved" = "open") => api<ConflictView[]>(`/kb/conflicts${qs({ status })}`),
  resolve: (id: string, body: ResolveBody) => api<{ factIds: string[] }>(`/kb/conflicts/${id}/resolve`, json("POST", body)),
};

// ---------- sources / sync ----------

export type SourceOrigin = ProfileSourceView["origin"];

export const sources = {
  list: () => api<ProfileSourceView[]>("/kb/sources"),
  patch: (origin: SourceOrigin, enabled: boolean) => api<unknown>(`/kb/sources/${origin}`, json("PATCH", { enabled })),
  import: (origin: SourceOrigin) => api<{ syncRunId: string }>(`/kb/sources/${origin}/import`, json("POST")),
};

export const sync = {
  now: () => api<{ syncRunId: string }>("/kb/sync", json("POST")),
  runs: (limit = 10) => api<SyncRunView[]>(`/kb/sync-runs${qs({ limit: String(limit) })}`),
};

// ---------- render ----------

export type RenderResult =
  | { overflow: false; pdf: Blob; atsScore: number | null; pages: number }
  | { overflow: true; pages: number; items: RenderItem[] };

export interface LintResult {
  score: number;
  checks: { id: string; pass: boolean; detail?: string }[];
  overflow?: { pages: number; items: RenderItem[] };
}

export const render = {
  async pdf(body: Partial<RenderRequest>): Promise<RenderResult> {
    try {
      const res = await request("/kb/render", json("POST", body));
      const score = res.headers.get("x-ats-score");
      return {
        overflow: false,
        pdf: await res.blob(),
        atsScore: score === null ? null : Number(score),
        pages: Number(res.headers.get("x-pages") ?? 1),
      };
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 422 && err.code === "overflow") {
        const d = (err.details ?? {}) as { pages?: number; items?: RenderItem[] };
        return { overflow: true, pages: d.pages ?? 2, items: d.items ?? [] };
      }
      throw err;
    }
  },
  lint: (body: Partial<RenderRequest>) => api<LintResult>("/kb/render/lint", json("POST", body)),
};

// ---------- F2: preferences / job sources / discovery / feed (specs/002-job-discovery-scoring) ----------

export const preferences = {
  get: () => api<Preferences>("/preferences"),
  suggest: () => api<Preferences>("/preferences/suggest"),
  /** Saves and re-applies hard filters; `refiltered` = jobs whose filter status changed. */
  async put(body: Preferences): Promise<{ prefs: Preferences; refiltered: number }> {
    const res = await request("/preferences", json("PUT", body));
    const refiltered = Number(res.headers.get("x-refiltered") ?? 0);
    return { prefs: (await res.json()) as Preferences, refiltered: Number.isFinite(refiltered) ? refiltered : 0 };
  },
};

export const jobSources = {
  list: () => api<SourceView[]>("/sources"),
  patch: (type: JobSourceType, body: { enabled?: boolean; dailyCap?: number; acceptTerms?: boolean }) =>
    api<SourceView>(`/sources/${type}`, json("PATCH", body)),
};

export const discovery = {
  start: () => api<{ runId: string }>("/discovery/runs", json("POST")),
  runs: (limit = 10) => api<DiscoveryRunView[]>(`/discovery/runs${qs({ limit: String(limit) })}`),
  get: (id: string) => api<DiscoveryRunView>(`/discovery/runs/${id}`),
  rescore: (judge: boolean) => api<{ runId: string }>("/scoring/rescore", json("POST", { judge })),
};

export type JobsFilter = Partial<Omit<JobsQuery, "minScore" | "maxScore" | "cursor" | "limit">> & {
  minScore?: number;
  maxScore?: number;
  cursor?: number;
  limit?: number;
};

export interface EvidenceFact {
  id: string;
  kind: string;
  summary: string;
}

export type JobDetail = JobCard & {
  description: string;
  matchedEvidence: { skill: string; facts: EvidenceFact[] }[];
};

export const jobs = {
  list: (f: JobsFilter = {}) => {
    const params: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null) params[k] = String(v);
    return api<{ items: JobCard[]; nextCursor: number | null }>(`/jobs${qs(params)}`);
  },
  get: (id: string) => api<JobDetail>(`/jobs/${id}`),
  patch: (id: string, body: { hidden?: boolean; interesting?: boolean }) => api<JobCard>(`/jobs/${id}`, json("PATCH", body)),
  blockCompany: (id: string) => api<{ company: string; hiddenJobs: number }>(`/jobs/${id}/block-company`, json("POST")),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
