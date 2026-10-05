import { NextResponse } from "next/server";
import { z } from "zod";
import { getProject, saveProject } from "@/server/project-store";

export const runtime = "nodejs";

const updateSchema = z.object({
  lines: z.array(z.object({
    id: z.string(),
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
    words: z.array(z.object({
      start: z.number().finite().nonnegative(),
      end: z.number().finite().nonnegative(),
    })),
  })),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await getProject(id));
  } catch {
    return NextResponse.json({ error: "Không tìm thấy dự án." }, { status: 404 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const project = await getProject(id);
    const payload = updateSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: "Dữ liệu mốc thời gian không hợp lệ." }, { status: 400 });
    }
    if (payload.data.lines.length !== project.timedLyrics.lines.length) {
      return NextResponse.json({ error: "Không được thêm hoặc xóa dòng lời trong bộ sửa timing." }, { status: 400 });
    }

    let previousEnd = 0;
    const updatedLines = payload.data.lines.map((line, index) => {
      const original = project.timedLyrics.lines[index];
      if (line.id !== original.id || line.words.length !== original.words.length) {
        throw new Error("Cấu trúc lời chuẩn không khớp với dự án.");
      }
      if (line.start > line.end || line.end > project.duration + 0.05 || line.start + 0.05 < previousEnd) {
        throw new Error("Các mốc thời gian phải tăng dần và nằm trong thời lượng audio.");
      }
      previousEnd = line.end;
      let previousWordEnd = line.start;
      const words = line.words.map((word, wordIndex) => {
        const originalWord = original.words[wordIndex];
        if (word.start > word.end || word.start + 0.05 < previousWordEnd || word.end > line.end + 0.05) {
          throw new Error("Mốc thời gian từng từ phải theo thứ tự và nằm trong dòng lời.");
        }
        previousWordEnd = word.end;
        return { ...originalWord, start: word.start, end: word.end };
      });
      return { ...original, start: line.start, end: line.end, words };
    });

    project.timedLyrics = { ...project.timedLyrics, lines: updatedLines };
    await saveProject(project);
    return NextResponse.json(project);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không lưu được timing.";
    return NextResponse.json({ error: message }, { status: message.includes("Không tìm thấy") ? 404 : 400 });
  }
}
