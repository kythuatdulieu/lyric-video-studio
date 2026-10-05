import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { z } from "zod";
import { getProject, getProjectOutputPath, getRenderManifestPath, getStoredAssetPath } from "@/server/project-store";
import { createRenderJob, getRenderJob, updateRenderJob, type RenderJob } from "@/server/render-job-store";
import type { LyricVideoProps } from "@/remotion/LyricVideo";

export const runtime = "nodejs";
export const maxDuration = 300;

const requestSchema = z.object({
  projectId: z.string().uuid(),
  mode: z.enum(["line", "karaoke"]).default("line"),
  visualizer: z.enum(["none", "vinyl", "waveform"]).default("none"),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/iu).default("#c8f169"),
  fontFamily: z.enum(["Arial, sans-serif", "Georgia, serif", "Trebuchet MS, sans-serif"]).default("Arial, sans-serif"),
  showProgress: z.boolean().default(true),
  width: z.enum(["1920", "1080", "1080-square"]).default("1920"),
});

type RenderSettings = z.infer<typeof requestSchema>;

let serveUrlPromise: Promise<string> | undefined;
const activeJobs = new Map<string, string>();

async function getServeUrl(): Promise<string> {
  if (!serveUrlPromise) {
    const outputDirectory = path.join(process.cwd(), ".lydra", "remotion-bundle");
    serveUrlPromise = (async () => {
      await mkdir(path.dirname(outputDirectory), { recursive: true });
      await rm(outputDirectory, { recursive: true, force: true });
      return bundle({ entryPoint: path.join(process.cwd(), "src", "remotion", "index.ts"), outDir: outputDirectory });
    })().catch((error: unknown) => {
      serveUrlPromise = undefined;
      throw error;
    });
  }
  return serveUrlPromise;
}

function configHash(settings: RenderSettings, timedLyrics: unknown): string {
  return createHash("sha256").update(JSON.stringify({ version: 3, settings, timedLyrics })).digest("hex");
}

function outputSize(format: RenderSettings["width"]): { width: number; height: number } {
  if (format === "1080") return { width: 1080, height: 1920 };
  if (format === "1080-square") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

async function runRenderJob(job: RenderJob, settings: RenderSettings): Promise<void> {
  try {
    await updateRenderJob(job.id, { status: "rendering", progress: 0 });
    const project = await getProject(job.projectId);
    const audioPath = getStoredAssetPath(project, "audio");
    if (!audioPath) throw new Error("Dự án chưa có audio.");
    const backgroundPath = getStoredAssetPath(project, "background");
    const assetOrigin = process.env.LYDRA_APP_URL || `http://127.0.0.1:${process.env.PORT || "3000"}`;
    const dimensions = outputSize(settings.width);
    const inputProps: LyricVideoProps = {
      lines: project.timedLyrics.lines,
      audioSrc: new URL(`/api/projects/${project.id}/audio`, assetOrigin).toString(),
      ...(backgroundPath ? { backgroundSrc: new URL(`/api/projects/${project.id}/background`, assetOrigin).toString() } : {}),
      backgroundKind: project.backgroundExtension && ["mp4", "mov", "webm"].includes(project.backgroundExtension) ? "video" : "image",
      mode: settings.mode,
      visualizer: settings.visualizer,
      accentColor: settings.accentColor,
      fontFamily: settings.fontFamily,
      showProgress: settings.showProgress,
      durationInSeconds: project.duration,
    };
    const serveUrl = await getServeUrl();
    const selectedComposition = await selectComposition({ serveUrl, id: "LydraLyricVideo", inputProps });
    const composition = {
      ...selectedComposition,
      ...dimensions,
      durationInFrames: Math.max(1, Math.ceil(project.duration * 30)),
      fps: 30,
    };
    let lastSavedProgress = -10;
    let progressWrite = Promise.resolve();
    const outputLocation = getProjectOutputPath(project);
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation,
      inputProps,
      crf: 19,
      concurrency: 6,
      pixelFormat: "yuv420p",
      onProgress: ({ progress }) => {
        const percentage = Math.min(99, Math.floor(progress * 100));
        if (percentage >= lastSavedProgress + 10) {
          lastSavedProgress = percentage;
          progressWrite = progressWrite.then(async () => {
            await updateRenderJob(job.id, { status: "rendering", progress: percentage });
          });
        }
      },
    });
    await progressWrite;
    await writeFile(getRenderManifestPath(project), JSON.stringify({ hash: job.configHash, createdAt: new Date().toISOString() }, null, 2), "utf8");
    await updateRenderJob(job.id, { status: "completed", progress: 100, url: `/api/projects/${project.id}/export` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không xuất được video.";
    await updateRenderJob(job.id, { status: "failed", error: message.slice(0, 500) });
  } finally {
    if (activeJobs.get(job.projectId) === job.id) activeJobs.delete(job.projectId);
  }
}

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "Thiếu jobId." }, { status: 400 });
  try {
    return NextResponse.json(await getRenderJob(jobId));
  } catch {
    return NextResponse.json({ error: "Không tìm thấy render job." }, { status: 404 });
  }
}

export async function POST(request: Request) {
  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Nội dung yêu cầu không phải JSON hợp lệ." }, { status: 400 });
  }
  const payload = requestSchema.safeParse(requestBody);
  if (!payload.success) return NextResponse.json({ error: "Cấu hình xuất video không hợp lệ." }, { status: 400 });
  try {
    const project = await getProject(payload.data.projectId);
    const hash = configHash(payload.data, project.timedLyrics);
    const runningId = activeJobs.get(project.id);
    if (runningId) return NextResponse.json(await getRenderJob(runningId), { status: 202 });

    const outputPath = getProjectOutputPath(project);
    const manifestPath = getRenderManifestPath(project);
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { hash?: string };
      await stat(outputPath);
      if (manifest.hash === hash) {
        const cached = await createRenderJob(project.id, hash);
        const completed = await updateRenderJob(cached.id, { status: "completed", progress: 100, url: `/api/projects/${project.id}/export` });
        return NextResponse.json(completed);
      }
    } catch {
      // Missing or stale output: queue a fresh render.
    }

    const job = await createRenderJob(project.id, hash);
    activeJobs.set(project.id, job.id);
    void runRenderJob(job, payload.data);
    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể bắt đầu render.";
    return NextResponse.json({ error: message.slice(0, 500) }, { status: 404 });
  }
}
