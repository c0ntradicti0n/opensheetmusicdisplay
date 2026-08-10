import { expect } from "vitest";
import { OpenSheetMusicDisplay } from "../../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { TestUtils } from "../../../Util/TestUtils";

/**
 * Issue 98 — skip repeated tuplet brackets.
 *
 * When TupletBracketsIfRepeatedOnlyFirst is enabled, a run of consecutive
 * identical tuplets (same kind, same note duration, same placement, no note
 * between the groups) renders a bracket only on its first tuplet. Repeats in
 * the run still render their tuplet number, just no bracket. A group after a
 * non-tuplet note starts a new run and keeps its bracket.
 */

interface TupletInfo {
    id: string;
    bracketY: number;
    xLeft: number;
    xRight: number;
}

const N2: string = "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>";
const START_BRACKET: string = '<notations><tuplet number="1" type="start" bracket="yes"/></notations>';
const STOP: string = '<notations><tuplet number="1" type="stop"/></notations>';

// 4/4, divisions 120 (480 ticks): triplet eighths (3x40), triplet eighths,
// quarter rest, triplet eighths. All triplets request bracket="yes".
const FIXTURE: string = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Pno</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>120</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>40</duration><voice>1</voice><type>eighth</type>${N2}${START_BRACKET}</note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>40</duration><voice>1</voice><type>eighth</type>${N2}</note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>40</duration><voice>1</voice><type>eighth</type>${N2}${STOP}</note>
      <note><pitch><step>A</step><octave>5</octave></pitch><duration>40</duration><voice>1</voice><type>eighth</type>${N2}${START_BRACKET}</note>
      <note><pitch><step>C</step><octave>6</octave></pitch><duration>40</duration><voice>1</voice><type>eighth</type>${N2}</note>
      <note><pitch><step>E</step><octave>6</octave></pitch><duration>40</duration><voice>1</voice><type>eighth</type>${N2}${STOP}</note>
      <note><rest/><duration>120</duration><voice>1</voice><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>40</duration><voice>1</voice><type>eighth</type>${N2}${START_BRACKET}</note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>40</duration><voice>1</voice><type>eighth</type>${N2}</note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>40</duration><voice>1</voice><type>eighth</type>${N2}${STOP}</note>
    </measure>
  </part>
</score-partwise>`;

// Same, but the second group is a triplet of QUARTERS (different written duration):
// a kind change must start a new run even though the groups are directly adjacent.
const FIXTURE_KIND_CHANGE: string = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Pno</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>120</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>40</duration><voice>1</voice><type>eighth</type>${N2}${START_BRACKET}</note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>40</duration><voice>1</voice><type>eighth</type>${N2}</note>
      <note><pitch><step>G</step><octave>5</octave></pitch><duration>40</duration><voice>1</voice><type>eighth</type>${N2}${STOP}</note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>80</duration><voice>1</voice><type>quarter</type>${N2}${START_BRACKET}</note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>80</duration><voice>1</voice><type>quarter</type>${N2}</note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>80</duration><voice>1</voice><type>quarter</type>${N2}${STOP}</note>
      <note><rest/><duration>120</duration><voice>1</voice><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

function renderToSVG(skipRepeatedBrackets: boolean, fixture: string = FIXTURE): Promise<SVGElement> {
    const container: HTMLElement = TestUtils.getDivElement(document);
    container.style.width = "1200px";
    container.style.height = "800px";
    const osmd: OpenSheetMusicDisplay = new OpenSheetMusicDisplay(
        container, { autoResize: false, backend: "svg", drawTitle: false }
    );
    osmd.EngravingRules.TupletBracketsIfRepeatedOnlyFirst = skipRepeatedBrackets;
    const scoreDoc: Document = new DOMParser().parseFromString(fixture, "text/xml");
    return osmd.load(scoreDoc).then(() => {
        osmd.render();
        const svg: SVGElement | null = container.querySelector("svg");
        if (!svg) { throw new Error("No SVG element after render"); }
        return svg;
    });
}

function parseBracketedTuplets(svg: SVGElement): TupletInfo[] {
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

describe("Issue 98 — tuplet bracket only on first of a repeated run", () => {
    it("renders a bracket on every tuplet when the rule is off (default)", async () => {
        const svg: SVGElement = await renderToSVG(false);
        const bracketed: TupletInfo[] = parseBracketedTuplets(svg);
        expect(bracketed.length, "all 3 tuplets should be bracketed by default").to.equal(3);
    });

    it("brackets only the first tuplet of each consecutive run when the rule is on", async () => {
        const svg: SVGElement = await renderToSVG(true);
        const bracketed: TupletInfo[] = parseBracketedTuplets(svg);
        // Group A starts the A-B run -> bracketed. Group B repeats A -> no bracket.
        // The quarter rest breaks the run, so group C starts a new run -> bracketed.
        expect(bracketed.length, "only the first of each run should be bracketed").to.equal(2);
        // The remaining tuplet group (B) still exists as a tuplet element with its number.
        const allTuplets: NodeListOf<Element> = svg.querySelectorAll("[class*='vf-tuplet']");
        expect(allTuplets.length, "tuplet numbers must still render on every group").to.equal(3);
    });

    it("brackets both groups when the tuplet kind changes (new run)", async () => {
        // Two directly adjacent groups of DIFFERENT written duration are different
        // runs: both keep their bracket.
        const svg: SVGElement = await renderToSVG(true, FIXTURE_KIND_CHANGE);
        const bracketed: TupletInfo[] = parseBracketedTuplets(svg);
        expect(bracketed.length, "kind change starts a new run, so both stay bracketed").to.equal(2);
        const allTuplets: NodeListOf<Element> = svg.querySelectorAll("[class*='vf-tuplet']");
        expect(allTuplets.length).to.equal(2);
    });
});
