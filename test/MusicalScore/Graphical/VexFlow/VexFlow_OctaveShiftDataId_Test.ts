import { expect } from "vitest";
import { OpenSheetMusicDisplay } from "../../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { TestUtils } from "../../../Util/TestUtils";

function renderToSVG(scorePath: string): Promise<SVGElement> {
    const container: HTMLElement = TestUtils.getDivElement(document);
    container.style.width = "1200px";
    container.style.height = "800px";
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

describe("Octave shift data-id attributes in SVG", () => {

    describe("Simple 8va piano score", () => {
        let shiftIds: string[];

        beforeAll((): Promise<void> => {
            return renderToSVG("test_octaveshift_8va_bass_clef_single_note.musicxml").then(
                (svg: SVGElement) => {
                    const els: Element[] = Array.from(
                        svg.querySelectorAll("[data-octave-shift-id]")
                    );
                    shiftIds = els.map((el: Element) =>
                        el.getAttribute("data-octave-shift-id")
                    ).filter((id: string | null): id is string => id !== null);
                }
            );
        });

        it("should have at least one data-octave-shift-id attribute in SVG", () => {
            expect(shiftIds.length).to.be.greaterThan(0,
                "expected at least one SVG element with data-octave-shift-id"
            );
        });

        it("should end with -8va suffix for 8va brackets", () => {
            const has8va: boolean = shiftIds.some((id: string) => id.endsWith("-8va"));
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(has8va).to.be.true;
        });
    });

});
