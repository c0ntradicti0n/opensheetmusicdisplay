/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from "vitest";
import { OpenSheetMusicDisplay } from "../../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { TestUtils } from "../../../Util/TestUtils";

// Issue 126: under renderSingleHorizontalStaffline, the flag of the bass-staff
// eighth note F4 (bar 3, beat 1 — voice 6, sharing the tick with the 16th-triplet
// A3-C4-F3) rendered ~30px below the stem tip, hanging next to the notehead.
//
// Root cause: the note's stem direction flips (down → up) during formatting, so
// buildFlag() rebuilds the flag glyph. measureText()'s shared cache HIT path then
// marked the element's metrics valid but returned the STALE _textMetrics measured
// for the previous (down-flag) glyph — whose actualBoundingBoxAscent is ~30 —
// so drawFlag() put the flag 30px too low.
//
// Assertion: for up-stem eighths the flag glyph baseline must sit at the stem tip
// (within 6px). Pre-fix the beat-1 bass flag was ~27px below its stem tip.

function renderToSVG(scorePath: string): Promise<SVGElement> {
    const container: HTMLElement = TestUtils.getDivElement(document);
    container.style.width = "2000px";
    container.style.height = "1200px";
    const osmd: OpenSheetMusicDisplay = new OpenSheetMusicDisplay(
        container, { autoResize: false, backend: "svg", drawTitle: false }
    );
    osmd.setOptions({
        renderSingleHorizontalStaffline: true,
        staffLineRelativeYPositions: [0, 15],
        drawPartNames: false,
        colorStemsLikeNoteheads: true,
    });
    (osmd.EngravingRules as any).RebaseSingleHorizontalStaffline = true;
    osmd.EngravingRules.StaffLineWidth = 0.1;
    osmd.EngravingRules.PageLeftMargin = 0.1;
    osmd.EngravingRules.PageRightMargin = 0;
    osmd.EngravingRules.MinimumStaffLineDistance = 7;
    osmd.EngravingRules.RenderMeasureNumbers = false;
    osmd.EngravingRules.StaffDistance = 15;
    osmd.EngravingRules.BetweenStaffDistance = 15;
    osmd.EngravingRules.SystemDistance = 15;
    osmd.EngravingRules.PageTopMargin = 2;
    return osmd.load(TestUtils.getScore(scorePath)).then(() => {
        osmd.render();
        const svg: SVGElement | null = container.querySelector("svg");
        if (!svg) { throw new Error("No SVG element after render"); }
        return svg;
    });
}

/** The note's own stem path (may live in a separate vf-beam group in VF5). */
function stemPath(svg: SVGElement, xmlId: string): { x: number, yBase: number, yTip: number } | null {
    const g: Element | null = svg.querySelector(`[id="vf-${xmlId}"]`);
    const path: Element | null =
        g?.querySelector("[class*='vf-stem'] path") ??
        svg.querySelector(`[class*='vf-beam'] [data-note-ids="${xmlId}"] path`);
    if (!path) { return null; }
    const d: string = path.getAttribute("d") ?? "";
    const m: RegExpMatchArray | null = d.match(/M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/);
    if (!m) { return null; }
    const x: number = parseFloat(m[1]);
    const y1: number = parseFloat(m[2]);
    const y2: number = parseFloat(m[4]);
    // Up-stem: tip is the smaller y. Down-stem: tip is the larger y.
    return { x, yBase: y1, yTip: y1 < y2 ? y1 : y2 };
}

/** Flag glyph text baseline (for up-stem flags this must be near the stem tip). */
function flagY(svg: SVGElement, xmlId: string): number | null {
    const g: Element | null = svg.querySelector(`[id="vf-${xmlId}"]`);
    const t: Element | null = g?.querySelector("[class*='vf-flag'] text");
    if (!t) { return null; }
    const y: number = parseFloat(t.getAttribute("y") ?? "NaN");
    return Number.isNaN(y) ? null : y;
}

describe("Flag position SVG (issue 126)", () => {
    let svg: SVGElement;

    beforeAll(async () => {
        svg = await renderToSVG(".issue126_flag_position.musicxml");
    });

    it("finds the stem and flag elements for the bass-staff eighths", () => {
        for (const id of ["p0n3_1", "p0n3_13"]) {
            expect(stemPath(svg, id), `${id} stem`).to.not.be.null;
            expect(flagY(svg, id), `${id} flag`).to.be.a("number");
        }
    });

    it("the beat-1 bass eighth (F4) flag sits at its stem tip", () => {
        const stem: { x: number, yBase: number, yTip: number } | null = stemPath(svg, "p0n3_1");
        const flag: number | null = flagY(svg, "p0n3_1");
        expect(stem, "p0n3_1 stem").to.not.be.null;
        expect(flag, "p0n3_1 flag").to.be.a("number");
        const gap: number = flag! - stem!.yTip;
        console.log(`\n  p0n3_1 stem tip y=${stem!.yTip.toFixed(1)} flag y=${flag!.toFixed(1)} gap=${gap.toFixed(1)}px`);
        // Pre-fix: gap ≈ +27 (flag hung next to the notehead). Post-fix: ≈ -3.
        expect(gap, `flag must sit at the stem tip (pre-fix: gap≈+27), got gap=${gap.toFixed(1)}px`).to.be.within(-6, 6);
    });

    it("the beat-3 bass eighth (E4) flag stays at its stem tip (regression guard)", () => {
        const stem: { x: number, yBase: number, yTip: number } | null = stemPath(svg, "p0n3_13");
        const flag: number | null = flagY(svg, "p0n3_13");
        expect(stem, "p0n3_13 stem").to.not.be.null;
        expect(flag, "p0n3_13 flag").to.be.a("number");
        const gap: number = flag! - stem!.yTip;
        console.log(`\n  p0n3_13 stem tip y=${stem!.yTip.toFixed(1)} flag y=${flag!.toFixed(1)} gap=${gap.toFixed(1)}px`);
        expect(gap, `flag must sit at the stem tip, got gap=${gap.toFixed(1)}px`).to.be.within(-6, 6);
    });
});
