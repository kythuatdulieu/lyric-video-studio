import { z } from "zod";
import type { STTWord } from "./alignment";
import { tokenize } from "./normalization";

const wordSchema = z.object({
  word: z.string().optional(),
  text: z.string().optional(),
  start: z.number(),
  end: z.number(),
  confidence: z.number().optional(),
});

const segmentSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  words: z.array(wordSchema).optional(),
});

const responseSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  duration: z.number().optional(),
  words: z.array(wordSchema).optional(),
  segments: z.array(segmentSchema).optional(),
  usage: z.object({ cost: z.number().optional(), seconds: z.number().optional() }).optional(),
});

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration: number;
  words: STTWord[];
  usage?: { cost?: number; seconds?: number };
  model: string;
}

function getWordText(word: z.infer<typeof wordSchema>): string {
  return word.word ?? word.text ?? "";
}

function estimatedWords(text: string, start: number, end: number): STTWord[] {
  const tokens = tokenize(text);
  if (!tokens.length) return [];
  const span = Math.max(0, end - start);
  return tokens.map((token, index) => ({
    text: token.text,
    start: start + (span * index) / tokens.length,
    end: start + (span * (index + 1)) / tokens.length,
  }));
}

function normaliseWords(raw: z.infer<typeof responseSchema>): STTWord[] {
  const direct = (raw.words ?? [])
    .map((word) => ({
      text: getWordText(word).trim(),
      start: word.start,
      end: word.end,
      ...(word.confidence !== undefined ? { confidence: word.confidence } : {}),
    }))
    .filter((word) => word.text);
  if (direct.length) return direct;

  const segmented = (raw.segments ?? []).flatMap((segment) => {
    const words = (segment.words ?? [])
      .map((word) => ({
        text: getWordText(word).trim(),
        start: word.start,
        end: word.end,
        ...(word.confidence !== undefined ? { confidence: word.confidence } : {}),
      }))
      .filter((word) => word.text);
    return words.length ? words : estimatedWords(segment.text, segment.start, segment.end);
  });
  if (segmented.length) return segmented;
  return estimatedWords(raw.text, 0, raw.duration ?? 0);
}

export async function transcribeWithOpenRouter(
  audio: Buffer,
  filename: string,
  mimeType: string,
  language?: string,
  lyrics?: string,
): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Thiếu OPENROUTER_API_KEY trong .env.");

  const model = process.env.OPENROUTER_STT_MODEL || "microsoft/mai-transcribe-2";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  if (language && language !== "auto") form.append("language", language);
  if (model === "microsoft/mai-transcribe-2" && lyrics?.trim()) {
    const phrases = lyrics
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !/^\[[^\]]+\]$/u.test(line))
      .slice(0, 100);
    form.append("provider", JSON.stringify({ options: { azure: { phraseList: { phrases } } } }));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 75_000);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    });
    const bodyText = await response.text();
    if (!response.ok) {
      let message = bodyText;
      try {
        const errorBody = JSON.parse(bodyText) as { error?: { message?: string } };
        message = errorBody.error?.message ?? bodyText;
      } catch {
        // Keep the upstream response text when it is not JSON.
      }
      throw new Error(`OpenRouter trả lỗi ${response.status}: ${message.slice(0, 500)}`);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(bodyText);
    } catch {
      throw new Error("OpenRouter trả về dữ liệu phiên âm không hợp lệ.");
    }
    const result = responseSchema.safeParse(parsedJson);
    if (!result.success) throw new Error("OpenRouter trả về thiếu trường phiên âm cần thiết.");

    const duration = result.data.duration ?? result.data.usage?.seconds ?? 0;
    const words = normaliseWords(result.data);
    if (!words.length) throw new Error("Không nhận diện được lời nói trong file âm thanh.");
    return {
      text: result.data.text,
      ...(result.data.language ? { language: result.data.language } : {}),
      duration: Math.max(duration, ...words.map((word) => word.end)),
      words,
      ...(result.data.usage ? { usage: result.data.usage } : {}),
      model,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenRouter mất quá nhiều thời gian. Hãy thử file ngắn hơn.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
