/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from "vitest";
import { OpenSheetMusicDisplay } from "../../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { TestUtils } from "../../../Util/TestUtils";

/**
 * Issue 90 — accent vs tuplet bracket, and Gould beamed-tuplet rule (issue 122).
 *
 * A foreign-voice note at the same tick shares its ModifierContext with the
 * tuplet's first note. VexFlow's Tuplet.getYPosition() used the shared
 * context's cumulative topTextLine, so a foreign accent (e.g. the strong
 * accent on the second treble voice) inflated the tuplet's clearance and
 * pushed its number/bracket far above the beam (y=-36 instead of y=1.5).
 *
 * Gould (#1400): a tuplet fully covered by one beam carries no bracket —
 * only its number. The number shares getYPosition with the bracket, so it
 * must still sit close above the beam, never detached by more than 25px
 * from the beam's highest point.
 */

interface TupletInfo {
    id: string;
    numberY: number;
    xLeft: number;
    xRight: number;
    hasBracket: boolean;
}

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

function parseTuplets(svg: SVGElement): TupletInfo[] {
    const result: TupletInfo[] = [];
    const tuplets: NodeListOf<Element> = svg.querySelectorAll("[class*='vf-tuplet']");
    for (let i: number = 0; i < tuplets.length; i++) {
        const t: Element = tuplets[i];
        const id: string = t.getAttribute("data-tuplet-id") || t.getAttribute("id") || `tuplet_${i}`;
        // The tuplet number is a <text> glyph (e.g. U+E883 "3"); the bracket,
        // if present, would be opaque rects with height 1 (the number shares
        // the tuplet's Y position either way).
        const textEl: Element | null = t.querySelector("text");
        if (!textEl) { continue; }
        const y: number = parseFloat(textEl.getAttribute("y") ?? "NaN");
        const x: number = parseFloat(textEl.getAttribute("x") ?? "NaN");
        if (Number.isNaN(y) || Number.isNaN(x)) { continue; }
        const bracketRects: Element[] = Array.from(t.querySelectorAll("rect"))
            .filter(r => r.getAttribute("opacity") !== "0" && parseFloat(r.getAttribute("height") ?? "0") < 2);
        result.push({ id, numberY: y, xLeft: x, xRight: x, hasBracket: bracketRects.length >= 2 });
    }
    return result;
}

function getBeamTopY(svg: SVGElement): number | undefined {
    let beamTop: number = Infinity;
    const beams: NodeListOf<Element> = svg.querySelectorAll("[class*='vf-beam']");
    for (let i: number = 0; i < beams.length; i++) {
        const paths: NodeListOf<Element> = beams[i].querySelectorAll(":scope > path");
        for (let j: number = 0; j < paths.length; j++) {
            const d: string = paths[j].getAttribute("d") || "";
            const coords: RegExpMatchArray | null = d.match(/[ML]([\d.]+)\s+([\d.]+)/g);
            if (!coords) { continue; }
            for (const c of coords) {
                const nums: RegExpMatchArray | null = c.match(/([\d.]+)\s+([\d.]+)/);
                if (nums) {
                    beamTop = Math.min(beamTop, parseFloat(nums[2]));
                }
            }
        }
    }
    return isFinite(beamTop) ? beamTop : undefined;
}

describe("Issue 90 — accent must not push the tuplet number", () => {
    let tuplets: TupletInfo[];
    let beamTop: number | undefined;

    beforeAll(function (): Promise<void> {
        return renderToSVG("issue90_accent_vs_tuplet.musicxml").then(
            (svg: SVGElement) => {
                tuplets = parseTuplets(svg);
                beamTop = getBeamTopY(svg);
            }
        );
    });

    it("score has 3 tuplets", () => {
        expect(tuplets.length).to.equal(3, "expected 3 tuplets, got " + tuplets.length);
    });

    it("beam is detected", () => {
        expect(beamTop).to.not.be.undefined;
    });

    it("beamed tuplets are number-only (Gould: no bracket)", () => {
        for (const t of tuplets) {
            expect(t.hasBracket, `tuplet ${t.id} should have no bracket when beamed`)
                .to.be.false;
        }
    });

    it("every tuplet number sits close above its beam", () => {
        expect(beamTop, "beam top Y required").to.not.be.undefined;
        const maxGap: number = 25;
        for (const t of tuplets) {
            const gap: number = beamTop! - t.numberY;
            expect(
                gap,
                `tuplet ${t.id} number at y=${t.numberY.toFixed(1)} is ` +
                `${gap.toFixed(1)}px above beam top y=${beamTop!.toFixed(1)} ` +
                "(max " + maxGap + "px; a foreign-voice accent used to inflate this)",
            ).to.be.at.most(maxGap);
        }
    });

    it("every tuplet number sits above the beam (not below it)", () => {
        for (const t of tuplets) {
            expect(t.numberY, `tuplet ${t.id} number y`).to.be.lessThan(beamTop! + 5);
        }
    });
});
