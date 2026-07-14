// "deno task test" to run this test

import { assertEquals } from "jsr:@std/assert@^1.0.17";
import { parseChordsText } from "./chords.ts";

const sample = `Intoxicados - Fuiste Lo Mejor

G                                C                 G
Yo no creo que esté todo bien si salto por la ventana
                        Em          Am                   D
Todo fue muy bueno y extraño hoy, tu cuerpo en mi habitación
G                                 C                G
Y perdona si te lastimé, pero quería que esto terminara
G               D           C       G
Lamento no haber sido lo mejor para voooss
G                                   C                     G
Cuando te deje y te dije que por un par de años más te amaría
                      Em                  Am                 D
Pero aunque no quiera estoy pensando como pude alejarme de voos
     G                        C                   G
Pero sé que te olvidaré pero hasta que llegue ese día
G                     D          C               G
Quiero que sepas que fuiste lo mejor

Bm                      G                      Am
Y dame un tiempo para poderlo pensaaar, es que
                      C             D
Estoy rodeado de emociones que me ahogan
Bm                         G
Pensé en decirte de intentar una vez maas
 C                    D
Pero no quisiera comenzar de nuevo

G                                C               G
Yo no se si esta todo bien si salto por la ventana
                      Em            Am                 D
Todo fue muy bueno y extraño hoy, tu cuerpo en mi habitacion
G                       C                      G
Y perdoná si te lastime, pero quería que esto terminara
G               D       C         G
Lamento no haber sido lo mejor para voooss

----------------- Acordes -----------------
Am = X 0 2 2 1 0
Bm = X 2 4 4 3 2
C = X 3 2 0 1 0
D = X X 0 2 3 2
Em = 0 2 2 0 0 0
G = 3 2 0 0 0 3
`;

Deno.test("parseChordsText - chord diagram legend", () => {
    const result = parseChordsText(sample);
    assertEquals(result.chordDefs, {
        Am: [-1, 0, 2, 2, 1, 0],
        Bm: [-1, 2, 4, 4, 3, 2],
        C: [-1, 3, 2, 0, 1, 0],
        D: [-1, -1, 0, 2, 3, 2],
        Em: [0, 2, 2, 0, 0, 0],
        G: [3, 2, 0, 0, 0, 3],
    });
});

Deno.test("parseChordsText - ignores the leading 'Artist - Title' header line", () => {
    const result = parseChordsText(sample);
    // First rendered line should be the blank spacer, not the header
    assertEquals(result.lines[0], { lyric: "", chords: [] });
});

Deno.test("parseChordsText - pairs a chord line with the lyric line below it", () => {
    const result = parseChordsText(sample);
    const line = result.lines[1];
    assertEquals(line.lyric, "Yo no creo que esté todo bien si salto por la ventana");
    assertEquals(line.chords, [
        { symbol: "G", column: 0 },
        { symbol: "C", column: 33 },
        { symbol: "G", column: 51 },
    ]);
});

Deno.test("parseChordsText - preserves column alignment for indented chord lines", () => {
    const result = parseChordsText(sample);
    const line = result.lines[2];
    assertEquals(line.lyric, "Todo fue muy bueno y extraño hoy, tu cuerpo en mi habitación");
    assertEquals(line.chords, [
        { symbol: "Em", column: 24 },
        { symbol: "Am", column: 36 },
        { symbol: "D", column: 57 },
    ]);
});

Deno.test("parseChordsText - blank lines become spacer entries", () => {
    const result = parseChordsText(sample);
    // The blank line between the 1st and 2nd verse
    const blankIndex = result.lines.findIndex((l, i) => l.lyric === "" && l.chords.length === 0 && i > 0);
    assertEquals(result.lines[blankIndex], { lyric: "", chords: [] });
});

Deno.test("parseChordsText - the chord legend section is excluded from lines", () => {
    const result = parseChordsText(sample);
    const joined = result.lines.map((l) => l.lyric).join("\n");
    assertEquals(joined.includes("Acordes"), false);
    assertEquals(joined.includes("Am = X"), false);
});

Deno.test("parseChordsText - no legend section present", () => {
    const result = parseChordsText("G\nHello world");
    assertEquals(result.chordDefs, {});
    assertEquals(result.lines, [
        { lyric: "Hello world", chords: [{ symbol: "G", column: 0 }] },
    ]);
});

Deno.test("parseChordsText - standalone chord line with no lyric below (instrumental)", () => {
    const result = parseChordsText("Intro:\nG C G\n\nSome lyric line");
    // "Intro:" is stripped as header, "G C G" chord line has no lyric line below (blank follows)
    assertEquals(result.lines[0], {
        lyric: "",
        chords: [
            { symbol: "G", column: 0 },
            { symbol: "C", column: 2 },
            { symbol: "G", column: 4 },
        ],
    });
    assertEquals(result.lines[1], { lyric: "", chords: [] });
    assertEquals(result.lines[2], { lyric: "Some lyric line", chords: [] });
});
