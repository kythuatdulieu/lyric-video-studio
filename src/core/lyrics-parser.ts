export interface LyricsSection {
  type: "section";
  id: string;
  label: string;
  render: false;
}

export interface LyricsLine {
  type: "line";
  id: string;
  text: string;
  sectionId?: string;
  sectionLabel?: string;
}

export type LyricsNode = LyricsSection | LyricsLine;

export interface ParsedLyrics {
  nodes: LyricsNode[];
  sections: LyricsSection[];
  lines: LyricsLine[];
}

const SECTION_PATTERN = /^\s*\[([^\]]+)\]\s*$/u;

export function parseLyrics(input: string): ParsedLyrics {
  const nodes: LyricsNode[] = [];
  const sections: LyricsSection[] = [];
  const lines: LyricsLine[] = [];
  let activeSection: LyricsSection | undefined;
  let lineIndex = 0;
  let sectionIndex = 0;

  for (const rawLine of input.normalize("NFC").split(/\r?\n/u)) {
    const text = rawLine.trim();
    if (!text) continue;

    const sectionMatch = SECTION_PATTERN.exec(text);
    if (sectionMatch) {
      const section: LyricsSection = {
        type: "section",
        id: `section-${sectionIndex++}`,
        label: sectionMatch[1].trim(),
        render: false,
      };
      activeSection = section;
      sections.push(section);
      nodes.push(section);
      continue;
    }

    const line: LyricsLine = {
      type: "line",
      id: `line-${lineIndex++}`,
      text,
      ...(activeSection
        ? { sectionId: activeSection.id, sectionLabel: activeSection.label }
        : {}),
    };
    lines.push(line);
    nodes.push(line);
  }

  return { nodes, sections, lines };
}
