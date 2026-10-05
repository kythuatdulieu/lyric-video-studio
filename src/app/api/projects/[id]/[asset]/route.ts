import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getProject, getStoredAssetPath } from "@/server/project-store";

export const runtime = "nodejs";

const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac",
  flac: "audio/flac", ogg: "audio/ogg", webm: "audio/webm",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", mp4: "video/mp4", mov: "video/quicktime",
};

function localOriginHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  try {
    const hostname = new URL(origin).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return {};
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
      Vary: "Origin",
    };
  } catch {
    return {};
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string; asset: string }> }) {
  try {
    const { id, asset } = await context.params;
    if (asset !== "audio" && asset !== "background") {
      return NextResponse.json({ error: "Không tìm thấy media." }, { status: 404 });
    }
    const project = await getProject(id);
    const filePath = getStoredAssetPath(project, asset);
    if (!filePath) return NextResponse.json({ error: "Dự án không có ảnh nền." }, { status: 404 });
    const extension = asset === "audio" ? project.sourceExtension : project.backgroundExtension;
    const mime = asset === "audio" ? project.sourceMimeType : project.backgroundMimeType;
    const bytes = await readFile(filePath);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mime ?? MIME_BY_EXTENSION[extension ?? ""] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(bytes.byteLength),
        ...localOriginHeaders(request),
      },
    });
  } catch {
    return NextResponse.json({ error: "Không tìm thấy dự án hoặc file media." }, { status: 404 });
  }
}
