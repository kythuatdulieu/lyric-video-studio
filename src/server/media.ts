import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const AUDIO_TYPES: Record<string, { mime: string; extension: string }> = {
  mp3: { mime: "audio/mpeg", extension: "mp3" },
  wav: { mime: "audio/wav", extension: "wav" },
  m4a: { mime: "audio/mp4", extension: "m4a" },
  aac: { mime: "audio/aac", extension: "aac" },
  flac: { mime: "audio/flac", extension: "flac" },
  ogg: { mime: "audio/ogg", extension: "ogg" },
  webm: { mime: "audio/webm", extension: "webm" },
};
const VIDEO_TYPES: Record<string, { mime: string; extension: string }> = {
  mp4: { mime: "video/mp4", extension: "mp4" },
  mov: { mime: "video/quicktime", extension: "mov" },
  webm: { mime: "video/webm", extension: "webm" },
};
const IMAGE_TYPES: Record<string, { mime: string; extension: string }> = {
  png: { mime: "image/png", extension: "png" },
  jpg: { mime: "image/jpeg", extension: "jpg" },
  jpeg: { mime: "image/jpeg", extension: "jpg" },
  webp: { mime: "image/webp", extension: "webp" },
};
const BACKGROUND_VIDEO_TYPES: Record<string, { mime: string; extension: string }> = {
  mp4: { mime: "video/mp4", extension: "mp4" },
  mov: { mime: "video/quicktime", extension: "mov" },
  webm: { mime: "video/webm", extension: "webm" },
};

export interface ProcessedMedia {
  audio: Buffer;
  mime: string;
  extension: string;
  originalMime: string;
  originalExtension: string;
  originalName: string;
}

function getExtension(name: string): string {
  return path.extname(path.basename(name)).slice(1).toLocaleLowerCase("en-US");
}

function safeOriginalName(name: string): string {
  return path.basename(name).replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 180) || "media";
}

export function validateAudioOrVideo(file: File): { kind: "audio" | "video"; mime: string; extension: string } {
  const extension = getExtension(file.name);
  const audio = AUDIO_TYPES[extension];
  const video = VIDEO_TYPES[extension];
  if (audio && (!file.type || file.type.startsWith("audio/") || file.type === "application/octet-stream")) {
    return { kind: "audio", ...audio };
  }
  if (video && (!file.type || file.type.startsWith("video/") || file.type === "application/octet-stream")) {
    return { kind: "video", ...video };
  }
  throw new Error("Định dạng media chưa được hỗ trợ. Hãy dùng MP3, WAV, M4A, AAC, FLAC, OGG, WebM, MP4 hoặc MOV.");
}

export function validateBackground(file: File): { mime: string; extension: string } {
  const extension = getExtension(file.name);
  const image = IMAGE_TYPES[extension];
  const video = BACKGROUND_VIDEO_TYPES[extension];
  const background = image ?? video;
  if (!background || (file.type && file.type !== background.mime && file.type !== "application/octet-stream")) {
    throw new Error("Nền cần ở định dạng PNG, JPG, WebP, MP4, MOV hoặc WebM.");
  }
  return background;
}

export async function prepareAudio(file: File): Promise<ProcessedMedia> {
  const mediaType = validateAudioOrVideo(file);
  const originalName = safeOriginalName(file.name);
  const originalBytes = Buffer.from(await file.arrayBuffer());
  const maxUpload = mediaType.kind === "video" ? 200 * 1024 * 1024 : 25 * 1024 * 1024;
  if (originalBytes.byteLength > maxUpload) {
    throw new Error(mediaType.kind === "video" ? "Video vượt quá giới hạn 200 MB." : "Audio vượt quá giới hạn 25 MB.");
  }

  if (mediaType.kind === "audio") {
    return {
      audio: originalBytes,
      mime: mediaType.mime,
      extension: mediaType.extension,
      originalMime: mediaType.mime,
      originalExtension: mediaType.extension,
      originalName,
    };
  }

  const directory = await mkdtemp(path.join(os.tmpdir(), "lydra-audio-"));
  const inputPath = path.join(directory, `source.${mediaType.extension}`);
  const outputPath = path.join(directory, "transcription.mp3");
  try {
    await writeFile(inputPath, originalBytes);
    await execFileAsync(process.env.FFMPEG_PATH || "ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-i", inputPath,
      "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k", "-y", outputPath,
    ], { timeout: 120_000, windowsHide: true });
    const audio = await readFile(outputPath);
    if (!audio.length) throw new Error("FFmpeg không trích xuất được âm thanh từ video.");
    if (audio.byteLength > 25 * 1024 * 1024) throw new Error("Audio sau khi trích xuất vượt quá giới hạn 25 MB.");
    return {
      audio,
      mime: "audio/mpeg",
      extension: "mp3",
      originalMime: mediaType.mime,
      originalExtension: mediaType.extension,
      originalName,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("Không tìm thấy FFmpeg. Cài FFmpeg hoặc đặt FFMPEG_PATH trong .env để xử lý video.");
    }
    if (error instanceof Error && error.message.includes("ENOENT")) {
      throw new Error("Không tìm thấy FFmpeg. Cài FFmpeg hoặc đặt FFMPEG_PATH trong .env để xử lý video.");
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
