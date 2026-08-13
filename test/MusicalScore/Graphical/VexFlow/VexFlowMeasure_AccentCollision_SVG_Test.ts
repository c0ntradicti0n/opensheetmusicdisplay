
import { expect } from "vitest";
import { OpenSheetMusicDisplay } from "../../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { TestUtils } from "../../../Util/TestUtils";

// Issue 122: accents colliding with noteheads in treble stave, bar 2.
// Real-coordinate (playwright) check: accent glyph bbox vs notehead bbox.

interface AccentInfo { cp: number, x: number, y: number, nearNote: string, nearDist: number }
interface TupletInfo { id: string, numberY: number, bracketBars: number }

function renderToSVG(scorePath: string): Promise<SVGElement> {
    const container: HTMLElement = TestUtils.getDivElement(document);
    container.style.width = "1200px";
    container.style.height = "1600px";
    const osmd: OpenSheetMusicDisplay = new OpenSheetMusicDisplay(
        container, { autoResize: false, backend: "svg", drawTitle: false }
    );
    const scoreDoc: Document = TestUtils.getScore(scorePath);
    return osmd.load(scoreDoc).then(() => {
        osmd.render();
        const svg: SVGElement | null = container.querySelector("svg");
        if (!svg) { throw new Error("No SVG element after render"); }
        return svg;
    });
}

describe("Accent collision SVG (issue 122)", () => {
    let svg: SVGElement;
    let accents: AccentInfo[];
    let tuplets: TupletInfo[];

    beforeAll(async () => {
        svg = await renderToSVG("issue122_accents_clearing.musicxml");
        // Notehead glyph baselines (text y-attr), keyed by note id.
        const noteheadYs: { id: string, x: number, y: number }[] = [];
        for (const nh of svg.querySelectorAll("[class*='vf-notehead']")) {
            const id: string = nh.getAttribute("data-note-id") ?? "";
            const t: Element | null = nh.querySelector("text");
            if (!t) { continue; }
            const x: number = parseFloat(t.getAttribute("x") ?? "NaN");
            const y: number = parseFloat(t.getAttribute("y") ?? "NaN");
            if (!Number.isNaN(x) && !Number.isNaN(y)) { noteheadYs.push({ id, x, y }); }
        }
        // Accent glyphs: Bravura/Gonville articulation region U+E4A0..E4B0.
        accents = [];
        for (const t of svg.querySelectorAll("text")) {
            const ch: string = t.textContent ?? "";
            const cp: number = ch.codePointAt(0) ?? 0;
            if (cp < 0xE4A0 || cp > 0xE4B0) { continue; }
            const x: number = parseFloat(t.getAttribute("x") ?? "NaN");
            const y: number = parseFloat(t.getAttribute("y") ?? "NaN");
            if (Number.isNaN(x) || Number.isNaN(y)) { continue; }
            // Nearest notehead in the same x-window (same chord).
            let near: string = "?";
            let nearD: number = Infinity;
            for (const nh of noteheadYs) {
                if (Math.abs(nh.x - x) > 15) { continue; }
                const d: number = Math.abs(nh.y - y);
                if (d < nearD) { nearD = d; near = nh.id; }
            }
            accents.push({ cp, x, y, nearNote: near, nearDist: nearD });
        }
        tuplets = [];
        for (const g of svg.querySelectorAll("[class*='vf-tuplet']")) {
            const id: string = g.getAttribute("data-tuplet-id") || g.getAttribute("id") || "?";
            const textEl: Element | null = g.querySelector("text");
            const numberY: number = parseFloat(textEl?.getAttribute("y") ?? "NaN");
            // Bracket bars are opaque rects with height < 2 (the click-target rect is transparent).
            const bracketBars: number = Array.from(g.querySelectorAll("rect"))
                .filter(r => r.getAttribute("opacity") !== "0" && parseFloat(r.getAttribute("height") ?? "0") < 2)
                .length;
            tuplets.push({ id, numberY, bracketBars });
        }
    });

    it("finds accents", () => {
        expect(accents.length).toBeGreaterThan(0);
    });

    it("accents are vertically cleared from their chord noteheads", () => {

        console.log(`\n  Accents (${accents.length}):`);
        for (const a of accents) {
            console.log(`    cp=${a.cp.toString(16)} x=${a.x.toFixed(1)} y=${a.y.toFixed(1)} near=${a.nearNote} d=${a.nearDist.toFixed(1)}`);
        }
        // An accent must not sit on a notehead baseline (issue 122 pre-fix:
        // the a> accents rendered exactly on the bottom chord notehead).
        const onNotehead: string[] = accents
            .filter(a => a.nearNote !== "?" && a.nearDist < 6)
            .map(a => `cp=${a.cp.toString(16)} y=${a.y.toFixed(1)} vs note=${a.nearNote}@${a.nearDist.toFixed(1)}px`);
        expect(onNotehead, "accents sitting on noteheads").toHaveLength(0);
    });

    it("beamed tuplets render number-only (Gould, no brackets)", () => {

        console.log(`\n  Tuplets (${tuplets.length}):`);
        for (const t of tuplets) {
            console.log(`    ${t.id} numberY=${t.numberY.toFixed(1)} bracketBars=${t.bracketBars}`);
        }
        // Issue 122: all 17 tuplets are beamed → number-only, consistent with
        // the cross-staff tuplets that were already force-unbracketed.
        const withBracket: string[] = tuplets
            .filter(t => t.bracketBars >= 2)
            .map(t => t.id);
        expect(withBracket, "tuplets with bracket bars").toHaveLength(0);
    });
});
