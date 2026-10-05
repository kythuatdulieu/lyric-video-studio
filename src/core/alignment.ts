import type { LyricsLine, ParsedLyrics } from "./lyrics-parser";
import { tokenize, tokenSimilarity, type TextToken } from "./normalization";

export const ALIGNMENT_VERSION = 4;

export interface STTWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface TimedWord {
  text: string;
  start: number;
  end: number;
  confidence: number;
  matched: boolean;
  sttText?: string;
}

export interface TimedLyricsLine {
  id: string;
  text: string;
  sectionId?: string;
  sectionLabel?: string;
  start: number;
  end: number;
  confidence: number;
  needsReview: boolean;
  words: TimedWord[];
}

export interface AlignmentResult {
  version: number;
  duration: number;
  confidence: number;
  lines: TimedLyricsLine[];
}

interface CanonicalToken extends TextToken {
  lineIndex: number;
}

interface Match {
  stt: STTWord;
  similarity: number;
}

function pairScore(left: string, right: string): number {
  const similarity = tokenSimilarity(left, right);
  if (similarity >= 0.999) return 8;
  if (similarity >= 0.87) return 6.5;
  if (similarity >= 0.72) return 2 + similarity;
  return -4.25;
}

function alignTokens(lyrics: CanonicalToken[], transcript: STTWord[]): Map<number, Match> {
  const n = lyrics.length;
  const m = transcript.length;
  if (!n || !m) return new Map();

  const width = m + 1;
  const scores = new Float64Array((n + 1) * width);
  const trace = new Uint8Array((n + 1) * width);
  const skipTranscript = -1.8;
  const skipLyric = -3.25;

  for (let i = 1; i <= n; i += 1) {
    scores[i * width] = i * skipLyric;
    trace[i * width] = 2;
  }
  for (let j = 1; j <= m; j += 1) {
    scores[j] = j * skipTranscript;
    trace[j] = 3;
  }

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const tieBreakTowardEarlierLyrics = (n - i) * 0.001;
      const diagonal = scores[(i - 1) * width + j - 1]
        + pairScore(lyrics[i - 1].text, transcript[j - 1].text)
        + tieBreakTowardEarlierLyrics;
      const skipCanonical = scores[(i - 1) * width + j] + skipLyric;
      const skipAudio = scores[i * width + j - 1] + skipTranscript;
      const offset = i * width + j;
      if (diagonal >= skipCanonical && diagonal >= skipAudio) {
        scores[offset] = diagonal;
        trace[offset] = 1;
      } else if (skipCanonical >= skipAudio) {
        scores[offset] = skipCanonical;
        trace[offset] = 2;
      } else {
        scores[offset] = skipAudio;
        trace[offset] = 3;
      }
    }
  }

  const matches = new Map<number, Match>();
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const direction = trace[i * width + j];
    if (i > 0 && j > 0 && direction === 1) {
      const similarity = tokenSimilarity(lyrics[i - 1].text, transcript[j - 1].text);
      if (similarity >= 0.72) matches.set(i - 1, { stt: transcript[j - 1], similarity });
      i -= 1;
      j -= 1;
    } else if (i > 0 && (direction === 2 || j === 0)) {
      i -= 1;
    } else if (j > 0) {
      j -= 1;
    } else {
      break;
    }
  }
  return matches;
}

function safeTimestamp(value: number, duration: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, value), duration);
}

function median(values: number[]): number {
  if (!values.length) return 0.65;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function alignLyrics(
  parsed: ParsedLyrics,
  transcriptWords: STTWord[],
  duration: number,
): AlignmentResult {
  const safeDuration = Math.max(0, Number.isFinite(duration) ? duration : 0);
  const canonical: CanonicalToken[] = [];
  const lineTokens = parsed.lines.map((line, lineIndex) => {
    const tokens = tokenize(line.text);
    for (const token of tokens) canonical.push({ ...token, lineIndex });
    return tokens;
  });
  const cleanTranscript = transcriptWords
    .filter((word) => word.text.trim() && Number.isFinite(word.start) && Number.isFinite(word.end))
    .map((word) => ({
      ...word,
      start: safeTimestamp(word.start, safeDuration),
      end: safeTimestamp(Math.max(word.start, word.end), safeDuration),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const matches = alignTokens(canonical, cleanTranscript);
  const timedTokens: Array<TimedWord | undefined> = new Array(canonical.length);
  for (const [index, match] of matches) {
    const rawStart = safeTimestamp(match.stt.start, safeDuration);
    const rawEnd = safeTimestamp(Math.max(match.stt.start, match.stt.end), safeDuration);
    timedTokens[index] = {
      text: canonical[index].text,
      start: rawStart,
      end: rawEnd,
      confidence: Math.max(0, Math.min(1, match.similarity * (match.stt.confidence ?? 1))),
      matched: true,
      sttText: match.stt.text,
    };
  }

  const typicalWordDuration = Math.max(0.25, Math.min(1.2, median(cleanTranscript
    .map((word) => Math.max(0, Math.min(2, word.end - word.start)))
    .filter((wordDuration) => wordDuration > 0))));

  // Fill missed lyrics at the local singing pace. If the recognizer leaves a
  // long gap, use only the expected phrase span and keep the remaining time as
  // an instrumental break. If two recognized words touch despite missing
  // lyric lines between them, move later anchors forward into available tail
  // slack instead of collapsing those lines to zero duration.
  let cursor = 0;
  while (cursor < canonical.length) {
    if (timedTokens[cursor]) {
      cursor += 1;
      continue;
    }
    const firstMissing = cursor;
    while (cursor < canonical.length && !timedTokens[cursor]) cursor += 1;
    const count = cursor - firstMissing;
    const previous = firstMissing > 0 ? timedTokens[firstMissing - 1] : undefined;
    const next = cursor < canonical.length ? timedTokens[cursor] : undefined;
    const gapStart = previous?.end ?? 0;
    let gapEnd = next?.start ?? safeDuration;
    let available = Math.max(0, gapEnd - gapStart);
    const weights = canonical.slice(firstMissing, cursor).map((token) => Math.max(1, Array.from(token.text).length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const requestedSpan = Math.min(safeDuration, count * typicalWordDuration * 1.15);
    const originalAvailable = available;

    if (previous && next && available < requestedSpan) {
      const latestTimedEnd = timedTokens.reduce((latest, word) => Math.max(latest, word?.end ?? 0), 0);
      const shift = Math.min(requestedSpan - available, Math.max(0, safeDuration - latestTimedEnd));
      if (shift > 0) {
        for (let index = cursor; index < timedTokens.length; index += 1) {
          const word = timedTokens[index];
          if (!word) continue;
          word.start += shift;
          word.end += shift;
        }
        gapEnd += shift;
        available += shift;
      }
    }

    let intervalStart: number;
    let intervalEnd: number;
    if (!previous && !next) {
      intervalStart = 0;
      intervalEnd = safeDuration;
    } else {
      if (previous && next) {
        intervalStart = gapStart;
        const keepInstrumentalGap = originalAvailable > requestedSpan * 1.45;
        intervalEnd = gapStart + Math.min(available, keepInstrumentalGap ? requestedSpan : available);
      } else if (next) {
        intervalEnd = gapEnd;
        intervalStart = Math.max(gapStart, intervalEnd - requestedSpan);
      } else {
        intervalStart = gapStart;
        intervalEnd = Math.min(gapEnd, intervalStart + requestedSpan);
      }
    }

    const interval = Math.max(0, intervalEnd - intervalStart);
    let tokenCursor = intervalStart;
    for (let offset = 0; offset < count; offset += 1) {
      const start = tokenCursor;
      const end = offset === count - 1
        ? intervalEnd
        : tokenCursor + (interval * weights[offset]) / totalWeight;
      timedTokens[firstMissing + offset] = {
        text: canonical[firstMissing + offset].text,
        start,
        end: Math.max(start, end),
        confidence: 0.2,
        matched: false,
      };
      tokenCursor = end;
    }
  }

  const resultLines: TimedLyricsLine[] = [];
  let canonicalIndex = 0;
  for (let lineIndex = 0; lineIndex < parsed.lines.length; lineIndex += 1) {
    const line = parsed.lines[lineIndex];
    const tokens = lineTokens[lineIndex];
    const matched = tokens.flatMap((_token, tokenIndex) => {
      const match = matches.get(canonicalIndex + tokenIndex);
      return match ? [match] : [];
    });
    const lineWords = tokens.map((_token, tokenIndex) => timedTokens[canonicalIndex + tokenIndex]!);
    canonicalIndex += tokens.length;
    const lineStart = lineWords[0]?.start ?? 0;
    const lineEnd = lineWords[lineWords.length - 1]?.end ?? lineStart;
    const matchRate = matched.length / Math.max(tokens.length, 1);
    const averageSimilarity = matched.length
      ? matched.reduce((sum, item) => sum + item.similarity * (item.stt.confidence ?? 1), 0) / matched.length
      : 0;
    const confidence = Math.max(0, Math.min(1, matchRate * averageSimilarity));

    resultLines.push({
      id: line.id,
      text: line.text,
      ...(line.sectionId ? { sectionId: line.sectionId } : {}),
      ...(line.sectionLabel ? { sectionLabel: line.sectionLabel } : {}),
      start: safeTimestamp(lineStart, safeDuration),
      end: safeTimestamp(Math.max(lineStart, lineEnd), safeDuration),
      confidence,
      needsReview: confidence < 0.62,
      words: lineWords,
    });
  }

  let lastTime = 0;
  for (const line of resultLines) {
    line.start = Math.max(lastTime, safeTimestamp(line.start, safeDuration));
    line.end = Math.max(line.start, safeTimestamp(line.end, safeDuration));
    if (line.end - line.start < 0.15 && line.start < safeDuration) {
      line.end = Math.min(safeDuration, line.start + 0.15);
    }
    for (const word of line.words) {
      word.start = Math.max(line.start, lastTime, safeTimestamp(word.start, safeDuration));
      word.end = Math.max(word.start, Math.min(line.end || safeDuration, safeTimestamp(word.end, safeDuration)));
      if (word.end - word.start < 0.15 && word.start < line.end) {
        word.end = Math.min(line.end, word.start + 0.15);
      }
      lastTime = word.end;
    }
    lastTime = Math.max(lastTime, line.start);
  }

  const totalWords = canonical.length;
  const matchedWords = matches.size;
  return {
    version: ALIGNMENT_VERSION,
    duration: safeDuration,
    confidence: totalWords ? matchedWords / totalWords : 0,
    lines: resultLines,
  };
}

export function canonicalLines(parsed: ParsedLyrics): LyricsLine[] {
  return parsed.lines;
}
