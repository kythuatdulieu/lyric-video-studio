import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AlignmentResult } from "@/core/alignment";

export interface StoredProject {
  id: string;
  name: string;
  createdAt: string;
  duration: number;
  language?: string;
  model: string;
  usage?: { cost?: number; seconds?: number };
  sourceFilename: string;
  sourceMimeType: string;
  sourceExtension: string;
  backgroundFilename?: string;
  backgroundMimeType?: string;
  backgroundExtension?: string;
  timedLyrics: AlignmentResult;
  lyrics: string;
}

const DATA_ROOT = path.join(process.cwd(), ".lydra", "projects");
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function projectDirectory(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error("Mã dự án không hợp lệ.");
  return path.join(DATA_ROOT, id);
}

export async function createProject(input: {
  name: string;
  source: Buffer;
  sourceFilename: string;
  sourceMimeType: string;
  sourceExtension: string;
  background?: Buffer;
  backgroundFilename?: string;
  backgroundMimeType?: string;
  backgroundExtension?: string;
  lyrics: string;
  timedLyrics: AlignmentResult;
  language?: string;
  model: string;
  usage?: { cost?: number; seconds?: number };
}): Promise<StoredProject> {
  const id = randomUUID();
  const directory = projectDirectory(id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `source.${input.sourceExtension}`), input.source);
  if (input.background && input.backgroundExtension) {
    await writeFile(path.join(directory, `background.${input.backgroundExtension}`), input.background);
  }

  const project: StoredProject = {
    id,
    name: input.name,
    createdAt: new Date().toISOString(),
    duration: input.timedLyrics.duration,
    ...(input.language ? { language: input.language } : {}),
    model: input.model,
    ...(input.usage ? { usage: input.usage } : {}),
    sourceFilename: input.sourceFilename,
    sourceMimeType: input.sourceMimeType,
    sourceExtension: input.sourceExtension,
    ...(input.backgroundFilename ? { backgroundFilename: input.backgroundFilename } : {}),
    ...(input.backgroundMimeType ? { backgroundMimeType: input.backgroundMimeType } : {}),
    ...(input.backgroundExtension ? { backgroundExtension: input.backgroundExtension } : {}),
    timedLyrics: input.timedLyrics,
    lyrics: input.lyrics,
  };
  await writeFile(path.join(directory, "project.json"), JSON.stringify(project, null, 2), "utf8");
  return project;
}

export async function getProject(id: string): Promise<StoredProject> {
  const directory = projectDirectory(id);
  const raw = await readFile(path.join(directory, "project.json"), "utf8");
  return JSON.parse(raw) as StoredProject;
}

export async function saveProject(project: StoredProject): Promise<void> {
  const directory = projectDirectory(project.id);
  await writeFile(path.join(directory, "project.json"), JSON.stringify(project, null, 2), "utf8");
}

export function getStoredAssetPath(project: StoredProject, asset: "audio" | "background"): string | null {
  const directory = projectDirectory(project.id);
  if (asset === "audio") return path.join(directory, `source.${project.sourceExtension}`);
  if (!project.backgroundExtension) return null;
  return path.join(directory, `background.${project.backgroundExtension}`);
}

export function getProjectOutputPath(project: StoredProject): string {
  return path.join(projectDirectory(project.id), `${project.id}.mp4`);
}

export function getRenderManifestPath(project: StoredProject): string {
  return path.join(projectDirectory(project.id), "render-manifest.json");
}
