export type ComplexityArtifactStatus =
  | "ready"
  | "missing"
  | "queued"
  | "running"
  | "failed";

export type ComplexityArtifactProgress = {
  completed_sectors: number;
  total_sectors: number;
  percent: number;
  current_sector_id: string | null;
};

export type ComplexityArtifactState = {
  status: ComplexityArtifactStatus;
  ready: boolean;
  state_key: string;
  selected_state_id: string | null;
  resource_date: string | null;
  cache_dir?: string;
  job_id?: string;
  progress?: ComplexityArtifactProgress;
  error?: string | null;
};

export const complexityArtifactCurrentPath = "/api/complexity_artifacts/current";

export function complexityArtifactJobPath(jobId: string): string {
  return `/api/complexity_artifacts/jobs/${encodeURIComponent(jobId)}`;
}
