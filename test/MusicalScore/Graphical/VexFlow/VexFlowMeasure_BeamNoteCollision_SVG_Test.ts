import { expect } from "vitest";
import { OpenSheetMusicDisplay } from "../../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { TestUtils } from "../../../Util/TestUtils";

// Issue 123: the polyphonic voice-2 beam (E4→F4, m19 beat 1.5) used to sit at a
// fixed VexFlow stem height that ran straight through the monophonic voice-1
// 16th-triplet noteheads (D#5, E5). resolveBeamNoteCollisions() extends the
// up-stem so the beamline clears the foreign noteheads in its x-range.
//
// Assertion: the colliding beam's fill rect must sit at least 5px above the
// highest foreign notehead baseline (pre-fix it was BELOW the baseline).

interface Rect { x1: number, x2: number, y1: number, y2: number }
interface Pt { x: number, y: number }

function renderToSVG(scorePath: string): Promise<SVGElement> {
    const container: HTMLElement = TestUtils.getDivElement(document);
    container.style.width = "2000px";
    container.style.height = "2400px";
    const osmd: OpenSheetMusicDisplay = new OpenSheetMusicDisplay(
        container, { autoResize: false, backend: "svg", drawTitle: false }
    );
    return osmd.load(TestUtils.getScore(scorePath)).then(() => {
        osmd.render();
        const svg: SVGElement | null = container.querySelector("svg");
        if (!svg) { throw new Error("No SVG element after render"); }
        return svg;
    });
}

/** Text baseline of a notehead glyph (the notehead center, approx). */
function noteheadBaseline(svg: SVGElement, xmlId: string): Pt | null {
    const nh: Element | null = svg.querySelector(`[data-note-id="${xmlId}"]`);
    const t: Element | null = nh?.querySelector("text");
    if (!t) { return null; }
    const x: number = parseFloat(t.getAttribute("x") ?? "NaN");
    const y: number = parseFloat(t.getAttribute("y") ?? "NaN");
    return Number.isNaN(x) || Number.isNaN(y) ? null : { x, y };
}

/** Opaque beam fill rects (path[stroke='none'], the beam ink). */
function beamFillRects(svg: SVGElement): Rect[] {
    const rects: Rect[] = [];
    for (const b of svg.querySelectorAll("[class*='vf-beam']")) {
        for (const p of b.querySelectorAll(":scope > path[stroke='none']")) {
            const d: string = p.getAttribute("d") ?? "";
            const nums: number[] = d.match(/[\d.]+/g)?.map(Number) ?? [];
            if (nums.length < 4) { continue; }
            let x1: number = Infinity, y1: number = Infinity, x2: number = -Infinity, y2: number = -Infinity;
            for (let i: number = 0; i + 1 < nums.length; i += 2) {
                if (nums[i] < x1) { x1 = nums[i]; }
                if (nums[i] > x2) { x2 = nums[i]; }
                if (nums[i + 1] < y1) { y1 = nums[i + 1]; }
                if (nums[i + 1] > y2) { y2 = nums[i + 1]; }
            }
            if (x1 < x2 && y1 < y2) { rects.push({ x1, x2, y1, y2 }); }
        }
    }
    return rects;
}

describe("Beam note-collision SVG (issue 123)", () => {
    let svg: SVGElement;
    let beamNotes: Pt[];
    let foreignNotes: Pt[];

    beforeAll(async () => {
        svg = await renderToSVG("issue123_strange_slur_beam_collisions.musicxml");
        // The colliding beam's own notes: voice-2 E4 (p0n19_6) → F4 (p0n19_13).
        beamNotes = ["p0n19_6", "p0n19_13"].map(id => noteheadBaseline(svg, id)!);
        // The foreign voice-1 16th-triplet noteheads the beam used to cross.
        foreignNotes = ["p0n19_10", "p0n19_11"].map(id => noteheadBaseline(svg, id)!);
    });

    it("finds the colliding beam notes and the foreign noteheads", () => {
        expect(beamNotes.length).to.equal(2);
        expect(foreignNotes.length).to.equal(2);
        for (const p of [...beamNotes, ...foreignNotes]) {
            expect(p.x).to.be.a("number");
            expect(p.y).to.be.a("number");
        }
    });

    it("the voice-2 up-stem beam clears the foreign 16th-triplet noteheads", () => {
        const minX: number = Math.min(beamNotes[0].x, beamNotes[1].x);
        const maxX: number = Math.max(beamNotes[0].x, beamNotes[1].x);
        const minBeamNoteY: number = Math.min(beamNotes[0].y, beamNotes[1].y);
        // The up-stem beam is the beam ink overlapping both beam notes' x (the
        // beam starts at the stem x, slightly inset from the notehead center)
        // and whose top is above (smaller Y than) the beam notes' baselines.
        const candidate: Rect[] = beamFillRects(svg).filter(
            r => r.x1 <= maxX + 5 && r.x2 >= minX - 5 && r.y2 < minBeamNoteY
        );
        expect(candidate.length, "up-stem beam covering E4→F4").to.be.at.least(1);
        const beamBottom: number = Math.max(...candidate.map(r => r.y2));

        // The beam's lower edge must sit clearly above the highest foreign notehead baseline.
        const highestForeignY: number = Math.min(...foreignNotes.map(p => p.y));
        const gap: number = highestForeignY - beamBottom;
        console.log(`\n  beam bottom=${beamBottom.toFixed(1)} highest foreign notehead y=${highestForeignY.toFixed(1)} gap=${gap.toFixed(1)}px`);
        expect(gap, `beam must clear foreign noteheads (pre-fix: gap<0), got gap=${gap.toFixed(1)}px`).to.be.at.least(5);
    });
});
