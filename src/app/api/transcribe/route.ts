import { NextResponse } from "next/server";
import { alignLyrics } from "@/core/alignment";
import { parseLyrics } from "@/core/lyrics-parser";
import { transcribeWithOpenRouter } from "@/core/transcription";
import { createProject } from "@/server/project-store";
import { prepareAudio, validateBackground } from "@/server/media";

export const runtime = "nodejs";
export const maxDuration = 90;

const MAX_BACKGROUND_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_BACKGROUND_VIDEO_BYTES = 200 * 1024 * 1024;

function userMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Không thể đồng bộ lời bài hát.";
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const lyrics = form.get("lyrics");
    const media = form.get("media");
    const languageValue = form.get("language");
    const background = form.get("background");

    if (typeof lyrics !== "string" || lyrics.trim().length === 0) {
      return NextResponse.json({ error: "Hãy nhập lời bài hát trước khi đồng bộ." }, { status: 400 });
    }
    if (lyrics.length > 100_000) {
      return NextResponse.json({ error: "Lời bài hát vượt quá giới hạn 100.000 ký tự." }, { status: 413 });
    }
    if (!(media instanceof File) || media.size === 0) {
      return NextResponse.json({ error: "Hãy chọn file âm thanh hoặc video." }, { status: 400 });
    }

    const parsed = parseLyrics(lyrics);
    if (!parsed.lines.length) {
      return NextResponse.json({ error: "Không tìm thấy dòng lời nào để đồng bộ." }, { status: 400 });
    }

    const processed = await prepareAudio(media);
    let backgroundData: { bytes: Buffer; mime: string; extension: string; name: string } | undefined;
    if (background instanceof File && background.size > 0) {
      const image = validateBackground(background);
      const maxBackgroundBytes = image.mime.startsWith("video/") ? MAX_BACKGROUND_VIDEO_BYTES : MAX_BACKGROUND_IMAGE_BYTES;
      if (background.size > maxBackgroundBytes) {
        return NextResponse.json({ error: image.mime.startsWith("video/") ? "Video nền vượt quá giới hạn 200 MB." : "Ảnh nền vượt quá giới hạn 20 MB." }, { status: 413 });
      }
      backgroundData = {
        bytes: Buffer.from(await background.arrayBuffer()),
        mime: image.mime,
        extension: image.extension,
        name: background.name.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 180),
      };
    }

    const language = typeof languageValue === "string" ? languageValue : "auto";
    const transcription = await transcribeWithOpenRouter(processed.audio, `audio.${processed.extension}`, processed.mime, language, lyrics);
    const timedLyrics = alignLyrics(parsed, transcription.words, transcription.duration);
    const project = await createProject({
      name: processed.originalName.replace(/\.[^.]+$/u, "") || "Dự án lyric video",
      source: processed.audio,
      sourceFilename: processed.originalName,
      sourceMimeType: processed.mime,
      sourceExtension: processed.extension,
      ...(backgroundData ? {
        background: backgroundData.bytes,
        backgroundFilename: backgroundData.name,
        backgroundMimeType: backgroundData.mime,
        backgroundExtension: backgroundData.extension,
      } : {}),
      lyrics,
      timedLyrics,
      ...(transcription.language ? { language: transcription.language } : {}),
      model: transcription.model,
      ...(transcription.usage ? { usage: transcription.usage } : {}),
    });

    return NextResponse.json({
      project,
      transcript: transcription.text,
      mediaUrl: `/api/projects/${project.id}/audio`,
      backgroundUrl: project.backgroundExtension ? `/api/projects/${project.id}/background` : null,
    });
  } catch (error) {
    const message = userMessage(error);
    const status = message.includes("OPENROUTER_API_KEY") ? 503
      : message.includes("OpenRouter trả lỗi") ? 502
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
