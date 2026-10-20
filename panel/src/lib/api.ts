// A typed client of contracts/http-api.md. The shapes come from the server (src/shared/api.ts),
// so a change there breaks the panel's type check instead of the page.
import type {
  ApiError as ApiErrorBody,
  CandidateDetail,
  CandidateList,
  CandidateState,
  Meta,
  ProfileName,
  Reinvestigation,
  VerdictValue,
} from "../../../src/shared/api";

export type * from "../../../src/shared/api";

type Fetch = typeof fetch;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(fetcher: Fetch, path: string, init?: RequestInit): Promise<T> {
  const res = await fetcher(path, init);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? "http_error", err?.message ?? `${res.status} ${res.statusText}`);
  }
  return body as T;
}

export interface CandidateFilters {
  state?: CandidateState[];
  verdict?: VerdictValue;
  /** YYYY-MM-DD, UTC. */
  from?: string;
  to?: string;
  page?: number;
}

export function candidatesQuery(f: CandidateFilters): string {
  const q = new URLSearchParams();
  if (f.state !== undefined && f.state.length > 0) q.set("state", f.state.join(","));
  if (f.verdict !== undefined) q.set("verdict", f.verdict);
  if (f.from !== undefined) q.set("from", f.from);
  if (f.to !== undefined) q.set("to", f.to);
  if (f.page !== undefined && f.page > 1) q.set("page", String(f.page));
  const s = q.toString();
  return s === "" ? "" : `?${s}`;
}

export const api = {
  meta: (fetcher: Fetch = fetch) => request<Meta>(fetcher, "/api/meta"),
  candidates: (f: CandidateFilters = {}, fetcher: Fetch = fetch) =>
    request<CandidateList>(fetcher, `/api/candidates${candidatesQuery(f)}`),
  candidate: (id: number, fetcher: Fetch = fetch) => request<CandidateDetail>(fetcher, `/api/candidates/${id}`),
  reinvestigate: (id: number, profile?: ProfileName, fetcher: Fetch = fetch) =>
    request<Reinvestigation>(fetcher, `/api/candidates/${id}/reinvestigate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profile === undefined ? {} : { profile }),
    }),
};
