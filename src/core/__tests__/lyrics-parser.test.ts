import { describe, expect, it } from "vitest";
import { parseLyrics } from "../lyrics-parser";

describe("parseLyrics", () => {
  it("keeps arbitrary bracketed labels as metadata and excludes them from render lines", () => {
    const parsed = parseLyrics("[Intro]\nXin chào...\n\n[Điệp Khúc]\nNắng lên trên phố rồi");

    expect(parsed.sections.map((section) => section.label)).toEqual(["Intro", "Điệp Khúc"]);
    expect(parsed.sections.every((section) => section.render === false)).toBe(true);
    expect(parsed.lines.map((line) => line.text)).toEqual(["Xin chào...", "Nắng lên trên phố rồi"]);
    expect(parsed.nodes.some((node) => node.type === "line" && node.text.includes("Intro"))).toBe(false);
  });

  it("preserves canonical spelling, punctuation, and Vietnamese accents", () => {
    const source = "[Verse 1]\nHôm nay trời sáng và trong xanh\nMẹ mở cửa, bé ngồi xem";
    const parsed = parseLyrics(source);

    expect(parsed.lines.map((line) => line.text)).toEqual([
      "Hôm nay trời sáng và trong xanh",
      "Mẹ mở cửa, bé ngồi xem",
    ]);
  });
});
