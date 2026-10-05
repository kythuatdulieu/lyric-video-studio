import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type RenderJobStatus = "queued" | "rendering" | "completed" | "failed";

export interface RenderJob {
  id: string;
  projectId: string;
  status: RenderJobStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  configHash: string;
  url?: string;
  error?: string;
}

const JOBS_DIRECTORY = path.join(process.cwd(), ".lydra", "jobs");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function jobPath(id: string): string {
  if (!UUID_PATTERN.test(id)) throw new Error("Mã render job không hợp lệ.");
  return path.join(JOBS_DIRECTORY, `${id}.json`);
}

export async function createRenderJob(projectId: string, configHash: string): Promise<RenderJob> {
  const now = new Date().toISOString();
  const job: RenderJob = {
    id: randomUUID(), projectId, status: "queued", progress: 0,
    createdAt: now, updatedAt: now, configHash,
  };
  await mkdir(JOBS_DIRECTORY, { recursive: true });
  await writeFile(jobPath(job.id), JSON.stringify(job, null, 2), "utf8");
  return job;
}

export async function getRenderJob(id: string): Promise<RenderJob> {
  const raw = await readFile(jobPath(id), "utf8");
  return JSON.parse(raw) as RenderJob;
}

export async function updateRenderJob(id: string, patch: Partial<Omit<RenderJob, "id" | "projectId" | "configHash" | "createdAt">>): Promise<RenderJob> {
  const current = await getRenderJob(id);
  const next: RenderJob = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await writeFile(jobPath(id), JSON.stringify(next, null, 2), "utf8");
  return next;
}
