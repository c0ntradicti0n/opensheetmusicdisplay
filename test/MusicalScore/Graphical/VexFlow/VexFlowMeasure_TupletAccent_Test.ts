/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from "vitest";
import { OpenSheetMusicDisplay } from "../../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { TestUtils } from "../../../Util/TestUtils";

/**
 * Issue 90 — accent vs tuplet bracket.
 *
 * A foreign-voice note at the same tick shares its ModifierContext with the
 * tuplet's first note. VexFlow's Tuplet.getYPosition() used the shared
 * context's cumulative topTextLine, so a foreign accent (e.g. the strong
 * accent on the second treble voice) inflated the bracket's clearance and
 * pushed the bracket far above the beam (y=-36 instead of y=1.5).
 *
 * Regression: each tuplet bracket must sit close above its own beam, never
 * detaching by more than 25px from the beam's highest point.
 */

interface TupletInfo {
    id: string;
    bracketY: number;
    xLeft: number;
    xRight: number;
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
        const rects: NodeListOf<Element> = t.querySelectorAll("rect");
        let bracketY: number = Infinity;
        let xLeft: number = Infinity;
        let xRight: number = -Infinity;
        for (let r: number = 0; r < rects.length; r++) {
            const rect: Element = rects[r];
            // Skip the transparent click-target rect (opacity="0").
            if (rect.getAttribute("opacity") === "0") { continue; }
            const y: string | null = rect.getAttribute("y");
            const x: string | null = rect.getAttribute("x");
            const w: string | null = rect.getAttribute("width");
            if (y && parseFloat(y) < bracketY) { bracketY = parseFloat(y); }
            if (x && parseFloat(x) < xLeft) { xLeft = parseFloat(x); }
            if (x && w && parseFloat(x) + parseFloat(w) > xRight) {
                xRight = parseFloat(x) + parseFloat(w);
            }
        }
        if (isFinite(bracketY)) {
            result.push({ id, bracketY, xLeft, xRight });
        }
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

describe("Issue 90 — accent must not push the tuplet bracket", () => {
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

    it("every tuplet bracket sits close above its beam", () => {
        expect(beamTop, "beam top Y required").to.not.be.undefined;
        const maxGap: number = 25;
        for (const t of tuplets) {
            const gap: number = beamTop! - t.bracketY;
            expect(
                gap,
                `tuplet ${t.id} bracket at y=${t.bracketY.toFixed(1)} is ` +
                `${gap.toFixed(1)}px above beam top y=${beamTop!.toFixed(1)} ` +
                "(max " + maxGap + "px; a foreign-voice accent used to inflate this)",
            ).to.be.at.most(maxGap);
        }
    });

    it("every tuplet bracket sits above the beam (not below it)", () => {
        for (const t of tuplets) {
            expect(t.bracketY, `tuplet ${t.id} bracket y`).to.be.lessThan(beamTop! + 5);
        }
    });
});
