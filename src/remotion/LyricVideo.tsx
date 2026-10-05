import React from "react";
import { getWaveformPortion } from "@remotion/media-utils";
import { AbsoluteFill, Audio, Img, Video, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { useWindowedAudioData } from "@remotion/media-utils";
import type { TimedLyricsLine } from "@/core/alignment";

export type LyricMode = "line" | "karaoke";
export type VisualizerMode = "none" | "vinyl" | "waveform";

export interface LyricVideoProps {
  [key: string]: unknown;
  lines: TimedLyricsLine[];
  audioSrc?: string;
  backgroundSrc?: string;
  backgroundKind?: "image" | "video";
  mode: LyricMode;
  visualizer: VisualizerMode;
  accentColor: string;
  fontFamily: string;
  showProgress: boolean;
  durationInSeconds: number;
}

const TOKEN_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;

const ROLL_DURATION = 0.36;
const ROW_GAP = 0.022;
const ROLL_OUT = 0.38;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function hasReliableWordTiming(lines: TimedLyricsLine[]): boolean {
  const words = lines.flatMap((line) => line.words);
  if (!words.length) return false;

  const matchedWords = words.filter((word) => word.matched && word.confidence >= 0.55).length;
  const reliableLines = lines.filter((line) => !line.needsReview && line.words.length > 0).length;
  return matchedWords / words.length >= 0.9 && reliableLines / Math.max(lines.length, 1) >= 0.8;
}

export function getLyricOpacityWindow(start: number, end: number): [number, number, number, number] {
  const duration = Math.max(0.06, end - start);
  const fadeIn = Math.min(0.2, duration / 3);
  const fadeOut = Math.min(0.15, duration / 3);
  const safeEnd = Math.max(end, start + 0.06);
  const fadeOutStart = Math.max(start + fadeIn + 0.001, safeEnd - fadeOut);
  return [start, start + fadeIn, fadeOutStart, safeEnd];
}

function estimateLyricRows(text: string, fontSize: number, maxWidth: number): number {
  let rows = 1;
  let occupiedWidth = 0;
  const averageCharacterWidth = fontSize * 0.54;
  for (const word of text.trim().split(/\s+/u)) {
    if (!word) continue;
    const wordWidth = Array.from(word).length * averageCharacterWidth;
    const nextWidth = occupiedWidth === 0 ? wordWidth : occupiedWidth + fontSize * 0.28 + wordWidth;
    if (occupiedWidth > 0 && nextWidth > maxWidth) {
      rows += 1;
      occupiedWidth = wordWidth;
    } else {
      occupiedWidth = nextWidth;
    }
  }
  return rows;
}

function KaraokeText({ line, seconds, accentColor }: { line: TimedLyricsLine; seconds: number; accentColor: string }) {
  const fragments: Array<{ text: string; wordIndex?: number }> = [];
  let cursor = 0;
  let wordIndex = 0;
  for (const match of line.text.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? cursor;
    if (start > cursor) fragments.push({ text: line.text.slice(cursor, start) });
    fragments.push({ text: match[0], wordIndex });
    cursor = start + match[0].length;
    wordIndex += 1;
  }
  if (cursor < line.text.length) fragments.push({ text: line.text.slice(cursor) });
  return <>{fragments.map((fragment, index) => {
    if (fragment.wordIndex === undefined) return <React.Fragment key={`p-${index}`}>{fragment.text}</React.Fragment>;
    const word = line.words[fragment.wordIndex];
    const wordDuration = word ? Math.max(0.08, word.end - word.start) : 0.08;
    const fill = word ? Math.min(1, Math.max(0, (seconds - word.start) / wordDuration)) : 0;
    const highlighted = fill > 0;
    return <span key={`w-${index}`} style={highlighted ? {
      color: "transparent",
      backgroundImage: `linear-gradient(90deg, ${accentColor} 0%, ${accentColor} ${fill * 100}%, #fff ${fill * 100}%, #fff 100%)`,
      backgroundClip: "text",
      WebkitBackgroundClip: "text",
      textShadow: fill > 0 && fill < 1 ? `0 0 26px ${accentColor}70` : undefined,
    } : undefined}>{fragment.text}</span>;
  })}</>;
}

function AudioWaveform({ src, accentColor, frame, fps }: { src: string; accentColor: string; frame: number; fps: number }) {
  const { audioData, dataOffsetInSeconds } = useWindowedAudioData({ src, frame, fps, windowInSeconds: 3 });
  if (!audioData) return null;
  const amplitudes = getWaveformPortion({
    audioData,
    startTimeInSeconds: frame / fps - 0.5,
    durationInSeconds: 1,
    numberOfSamples: 48,
    dataOffsetInSeconds,
    outputRange: "zero-to-one",
    normalize: true,
  });
  return <div style={{ position: "absolute", left: "18%", right: "18%", bottom: "13%", height: 62, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: 0.88 }}>
    {amplitudes.map(({ index, amplitude }) => <div key={index} style={{ width: 5, height: 5 + Math.min(1, amplitude) * 52, borderRadius: 8, background: `linear-gradient(180deg, ${accentColor}, ${accentColor}65)` }} />)}
  </div>;
}

export function LyricVideo(props: LyricVideoProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const seconds = frame / fps;
  const activeIndex = props.lines.findIndex((line) => seconds >= line.start && seconds < line.end);
  const karaokeOnly = props.mode === "karaoke" && hasReliableWordTiming(props.lines);
  let displayIndex = activeIndex;
  let rollProgress = 0;
  // The first lyric has no previous row, but it still has a next row to roll into.
  const hasContext = (index: number) => index >= 0 && index + 1 < props.lines.length;
  const getRollWindow = (index: number): [number, number] => {
    const current = props.lines[index];
    const next = props.lines[index + 1];
    const gap = next.start - current.end;
    if (gap >= ROLL_DURATION) return [current.end, current.end + ROLL_DURATION];
    if (gap > 0) return [current.end - (ROLL_DURATION - gap), next.start];
    return [current.end - ROLL_DURATION, current.end];
  };

  if (!karaokeOnly && activeIndex >= 0 && hasContext(activeIndex)) {
    const [rollStart, rollEnd] = getRollWindow(activeIndex);
    rollProgress = clamp01((seconds - rollStart) / Math.max(0.001, rollEnd - rollStart));
  } else if (!karaokeOnly && activeIndex < 0) {
    for (let index = props.lines.length - 2; index >= 0; index -= 1) {
      const current = props.lines[index];
      const next = props.lines[index + 1];
      if (hasContext(index) && seconds >= current.end && seconds < next.start) {
        displayIndex = index;
        const [rollStart, rollEnd] = getRollWindow(index);
        rollProgress = clamp01((seconds - rollStart) / Math.max(0.001, rollEnd - rollStart));
        break;
      }
    }
  }

  const mainFontSize = Math.max(48, Math.min(width * 0.05, 108));
  const neighborFontSize = Math.max(28, Math.min(width * 0.028, 58));
  const neighborScale = neighborFontSize / mainFontSize;
  const lineHeight = mainFontSize * 1.22;
  const rowGap = Math.max(12, Math.min(height * ROW_GAP, 28));
  const rowHeightFor = (lineIndex: number) => {
    const line = props.lines[lineIndex];
    if (!line) return lineHeight + rowGap;
    const rowCount = estimateLyricRows(line.text, mainFontSize, width * 0.76);
    return rowCount * lineHeight + rowGap;
  };
  const rowIndexes = displayIndex >= 0
    ? (karaokeOnly ? [displayIndex] : [displayIndex - 1, displayIndex, displayIndex + 1, displayIndex + 2])
    : [];
  const rowHeights = rowIndexes.map((index) => rowHeightFor(index));
  const rowTops: number[] = [];
  let stackHeight = 0;
  for (const rowHeight of rowHeights) {
    rowTops.push(stackHeight);
    stackHeight += rowHeight;
  }
  const centerRowIndex = karaokeOnly ? 0 : 1;
  const activeCenterOffset = rowHeights.length > centerRowIndex ? rowTops[centerRowIndex] + rowHeights[centerRowIndex] / 2 : 0;
  const rollDistance = rowHeights.length > 2 ? (rowHeights[1] + rowHeights[2]) / 2 : 0;
  const stackOffset = -activeCenterOffset - rollProgress * rollDistance;
  const progress = props.durationInSeconds > 0 ? seconds / props.durationInSeconds : 0;
  const recordRotation = frame * 0.45;

  return <AbsoluteFill style={{ backgroundColor: "#111312", color: "#fff", fontFamily: props.fontFamily }}>
    {props.backgroundSrc ? (props.backgroundKind === "video"
      ? <Video src={props.backgroundSrc} muted loop style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      : <Img src={props.backgroundSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />) : null}
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(8,12,10,.12), rgba(8,12,10,.58) 58%, rgba(8,12,10,.76))" }} />
    {props.audioSrc ? <Audio src={props.audioSrc} /> : null}

    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "5% 12% 16%", overflow: "hidden" }}>
      {displayIndex >= 0 ? <div style={{ position: "relative", width: "100%", height: 0, transform: `translateY(${stackOffset}px)`, flexShrink: 0 }}>
        {rowIndexes.map((lineIndex, rowIndex) => {
          const line = props.lines[lineIndex];
          if (!line) return null;
          const relativePosition = karaokeOnly ? 0 : rowIndex - 1;
          let opacity = karaokeOnly ? 1 : ROLL_OUT;
          let textScale = karaokeOnly ? 1 : neighborScale;
          if (relativePosition === -1) opacity *= 1 - rollProgress;
          if (relativePosition === 0) {
            opacity = 1 - (1 - ROLL_OUT) * rollProgress;
            textScale = 1 - (1 - neighborScale) * rollProgress;
          }
          if (relativePosition === 1) {
            opacity = ROLL_OUT + (1 - ROLL_OUT) * rollProgress;
            textScale = neighborScale + (1 - neighborScale) * rollProgress;
          }
          if (relativePosition === 2) opacity = ROLL_OUT * rollProgress;
          return <div key={line.id} style={{ position: "absolute", top: rowTops[rowIndex], left: 0, right: 0, height: rowHeights[rowIndex], display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "100%", maxWidth: relativePosition === 0 ? "100%" : "92%", color: "#fff", opacity, textAlign: "center", fontSize: mainFontSize * textScale, fontWeight: Math.round(500 + 200 * textScale), lineHeight: 1.22, letterSpacing: "0.005em", textShadow: relativePosition === 0 ? "0 4px 32px rgba(0,0,0,.58)" : "0 3px 22px rgba(0,0,0,.55)" }}>
              {karaokeOnly ? <KaraokeText line={line} seconds={seconds} accentColor={props.accentColor} /> : line.text}
            </div>
          </div>;
        })}
      </div> : null}
    </AbsoluteFill>

    {props.visualizer === "vinyl" ? <div style={{ position: "absolute", width: 280, height: 280, borderRadius: "50%", right: "7%", bottom: "14%", transform: `rotate(${recordRotation}deg)`, background: "repeating-radial-gradient(circle, #151615 0 5px, #252726 6px 7px, #111 8px 11px)", border: "8px solid rgba(255,255,255,.12)", boxShadow: "0 18px 80px rgba(0,0,0,.5)" }}><div style={{ position: "absolute", inset: "38%", borderRadius: "50%", background: props.accentColor, display: "grid", placeItems: "center", color: "#102018", fontSize: 16, fontWeight: 800 }}>LYDRA</div></div> : null}
    {props.visualizer === "waveform" && props.audioSrc ? <AudioWaveform src={props.audioSrc} accentColor={props.accentColor} frame={frame} fps={fps} /> : null}
    {props.showProgress ? <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 9, background: "rgba(255,255,255,.22)" }}><div style={{ height: "100%", width: `${Math.min(100, Math.max(0, progress * 100))}%`, background: props.accentColor }} /></div> : null}
  </AbsoluteFill>;
}
