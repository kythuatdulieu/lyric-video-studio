import { describe, expect, it } from "vitest";
import { alignLyrics, type STTWord } from "../alignment";
import { parseLyrics } from "../lyrics-parser";

const word = (text: string, start: number, end = start + 0.25): STTWord => ({ text, start, end });

describe("alignLyrics", () => {
  it("aligns repeated lyrics to later occurrences using monotonic sequence order", () => {
    const parsed = parseLyrics("Mưa cứ rơi\nMưa cứ rơi");
    const result = alignLyrics(parsed, [
      word("Mưa", 1), word("cứ", 1.3), word("rơi", 1.6),
      word("Mưa", 8), word("cứ", 8.3), word("rơi", 8.6),
    ], 12);

    expect(result.lines[0].start).toBe(1);
    expect(result.lines[1].start).toBe(8);
    expect(result.lines[1].words.map((item) => item.sttText)).toEqual(["Mưa", "cứ", "rơi"]);
  });

  it("matches a Vietnamese diacritic variant but keeps the user's canonical text", () => {
    const result = alignLyrics(parseLyrics("Mẹ mở cửa, bé ngồi xem"), [
      word("Mẹ", 0.1), word("mở", 0.4), word("cửa", 0.7), word("be", 1), word("ngồi", 1.3), word("xen", 1.6),
    ], 3);

    expect(result.lines[0].text).toBe("Mẹ mở cửa, bé ngồi xem");
    expect(result.lines[0].words.map((item) => item.text)).toEqual(["Mẹ", "mở", "cửa", "bé", "ngồi", "xem"]);
    expect(result.lines[0].words[3].matched).toBe(true);
  });

  it("skips unrelated STT words and keeps line timestamps monotonic", () => {
    const result = alignLyrics(parseLyrics("Chào nhé...\nNắng lên trên phố rồi"), [
      word("Chào", 0.4), word("nhé", 0.65), word("subscribe", 1.2),
      word("Nắng", 3.1), word("lên", 3.4), word("trên", 3.7), word("phố", 4), word("rồi", 4.3),
    ], 6);

    expect(result.lines[0].text).toBe("Chào nhé...");
    expect(result.lines[1].text).toBe("Nắng lên trên phố rồi");
    expect(result.lines[1].start).toBeGreaterThanOrEqual(result.lines[0].end);
    expect(result.lines.flatMap((line) => line.words).every((item) => item.start <= item.end)).toBe(true);
  });

  it("marks a line with no transcript match for manual review", () => {
    const result = alignLyrics(parseLyrics("Lời hoàn toàn khác"), [word("âm", 1), word("nhạc", 1.4)], 5);
    expect(result.lines[0].needsReview).toBe(true);
    expect(result.lines[0].confidence).toBeLessThan(0.62);
  });

  it("keeps a missing line brief and preserves a long instrumental gap", () => {
    const result = alignLyrics(parseLyrics("Trời đã khuya\nLời bị STT bỏ qua\nCon ngủ ngoan"), [
      word("Trời", 1), word("đã", 1.25), word("khuya", 1.5),
      word("Con", 10), word("ngủ", 10.25), word("ngoan", 10.5),
    ], 15);

    expect(result.lines[1].needsReview).toBe(true);
    expect(result.lines[1].start).toBe(result.lines[0].end);
    expect(result.lines[1].end).toBeLessThan(result.lines[2].start);
    expect(result.lines[1].end - result.lines[1].start).toBeGreaterThan(0);
    expect(result.lines[1].end - result.lines[1].start).toBeLessThan(2);
    expect(result.lines[2].start - result.lines[1].end).toBeGreaterThan(5);
    expect(result.lines[1].words[0].start).toBe(result.lines[1].start);
    expect(result.lines[1].words.at(-1)?.end).toBe(result.lines[1].end);
  });
});
