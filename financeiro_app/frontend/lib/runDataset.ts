export const DATASET_STATUS_PAGE = 800;
export const DATASET_MATCH_PAGE = 500;

export type RunDatasetPage = {
  metric: unknown;
  matches: unknown[];
  statuses: unknown[];
  statuses_total?: number;
  matches_total?: number;
  status_month_counts?: Record<string, number>;
};

export function isRunDatasetComplete(data: RunDatasetPage | null | undefined): boolean {
  if (!data) return false;
  const statusesTotal = data.statuses_total ?? data.statuses.length;
  const matchesTotal = data.matches_total ?? data.matches.length;
  return data.statuses.length >= statusesTotal && data.matches.length >= matchesTotal;
}

export function mergeRunDatasetChunk<T extends RunDatasetPage>(base: T, chunk: RunDatasetPage): T {
  return {
    ...base,
    metric: chunk.metric ?? base.metric,
    statuses_total: chunk.statuses_total ?? base.statuses_total,
    matches_total: chunk.matches_total ?? base.matches_total,
    status_month_counts:
      chunk.status_month_counts && Object.keys(chunk.status_month_counts).length > 0
        ? chunk.status_month_counts
        : base.status_month_counts,
    statuses: (chunk.statuses.length ? [...base.statuses, ...chunk.statuses] : base.statuses) as T["statuses"],
    matches: (chunk.matches.length ? [...base.matches, ...chunk.matches] : base.matches) as T["matches"],
  };
}

export function buildRunDatasetQuery(params: {
  status_offset: number;
  status_limit: number;
  match_offset: number;
  match_limit: number;
  include_month_counts?: boolean;
}): string {
  const query = new URLSearchParams({
    status_offset: String(params.status_offset),
    status_limit: String(params.status_limit),
    match_offset: String(params.match_offset),
    match_limit: String(params.match_limit),
  });
  if (params.include_month_counts === false) {
    query.set("include_month_counts", "false");
  }
  return query.toString();
}
