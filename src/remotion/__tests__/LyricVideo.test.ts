import { describe, expect, it } from "vitest";
import { getLyricOpacityWindow } from "../LyricVideo";

describe("lyric transition timing", () => {
  it.each([
    [1, 3],
    [164.08, 164.13],
    [12, 12.2],
  ])("keeps a strictly increasing fade range for %s–%s seconds", (start, end) => {
    const range = getLyricOpacityWindow(start, end);
    expect(range.every((time, index) => index === 0 || time > range[index - 1])).toBe(true);
  });
});
