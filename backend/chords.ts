import { ChordLine, ChordsData, ChordsDataSchema } from "./zod.ts";

// A chord token: a note letter A-G, optional sharp/flat, optional quality, optional
// scale degree digits, optional slash bass note. e.g. G, Am, C#m7, Bb, Asus4, C/E
const CHORD_TOKEN_RE = /^[A-G][#b]?(?:maj|min|m|dim|aug|sus)?\d*(?:\/[A-G][#b]?)?$/;

// A line made up entirely of dashes wrapping (optionally) some text, e.g.
// "----------------- Acordes -----------------"
const LEGEND_DELIMITER_RE = /^-{3,}.*-{3,}$/;

// A chord definition line, e.g. "Am = X 0 2 2 1 0"
const CHORD_DEF_RE = /^(\S+)\s*=\s*(.+)$/;

function isChordLine(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
        return false;
    }
    const tokens = trimmed.split(/\s+/);
    return tokens.every((token) => CHORD_TOKEN_RE.test(token));
}

/**
 * Extract chord symbols and their character column (in the original, un-trimmed line),
 * so the column lines up with the lyric line rendered directly below it.
 */
function extractChords(line: string) {
    const chords: { symbol: string; column: number }[] = [];
    for (const match of line.matchAll(/\S+/g)) {
        chords.push({ symbol: match[0], column: match.index ?? 0 });
    }
    return chords;
}

function parseBody(lines: string[]): ChordLine[] {
    const result: ChordLine[] = [];
    let i = 0;

    // A leading non-chord line (e.g. "Artist - Title") is a header comment, not lyrics
    if (lines.length > 0 && lines[0].trim().length > 0 && !isChordLine(lines[0])) {
        i = 1;
    }

    while (i < lines.length) {
        const line = lines[i];

        if (line.trim().length === 0) {
            result.push({ lyric: "", chords: [] });
            i++;
            continue;
        }

        if (isChordLine(line)) {
            const chords = extractChords(line);
            const next = lines[i + 1];

            // Pair with the next line if it's a lyric line (non-empty, not itself a chord line)
            if (next !== undefined && next.trim().length > 0 && !isChordLine(next)) {
                result.push({ lyric: next, chords });
                i += 2;
            } else {
                // Standalone chord line, e.g. an instrumental intro/interlude
                result.push({ lyric: "", chords });
                i += 1;
            }
        } else {
            result.push({ lyric: line, chords: [] });
            i += 1;
        }
    }

    return result;
}

function parseLegend(lines: string[]): Record<string, number[]> {
    const defs: Record<string, number[]> = {};

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        const match = CHORD_DEF_RE.exec(trimmed);
        if (!match) {
            continue;
        }

        const name = match[1];
        const frets = match[2].trim().split(/\s+/).map((token) => {
            if (token.toLowerCase() === "x") {
                return -1;
            }
            const n = parseInt(token, 10);
            return Number.isNaN(n) ? -1 : n;
        });

        defs[name] = frets;
    }

    return defs;
}

/**
 * Parse a Cifra-Club-style chords TXT: chord lines above lyric lines, blank-line
 * separated sections, followed by a "----- Acordes -----" delimiter and a
 * `Name = fret fret fret fret fret fret` chord diagram legend.
 */
export function parseChordsText(text: string): ChordsData {
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

    const delimiterIndex = lines.findIndex((line) => LEGEND_DELIMITER_RE.test(line.trim()));

    const bodyLines = delimiterIndex >= 0 ? lines.slice(0, delimiterIndex) : lines.slice();
    const legendLines = delimiterIndex >= 0 ? lines.slice(delimiterIndex + 1) : [];

    // Trim trailing blank lines left over from the gap before the delimiter
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim().length === 0) {
        bodyLines.pop();
    }

    return ChordsDataSchema.parse({
        lines: parseBody(bodyLines),
        chordDefs: parseLegend(legendLines),
    });
}
