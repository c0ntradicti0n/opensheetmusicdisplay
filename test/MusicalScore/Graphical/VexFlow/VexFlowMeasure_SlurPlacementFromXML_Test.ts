/* eslint-disable @typescript-eslint/typedef */
import { expect } from "vitest";
import { OpenSheetMusicDisplay } from "../../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { TestUtils } from "../../../Util/TestUtils";
import { GraphicalSlur } from "../../../../src/MusicalScore/Graphical/GraphicalSlur";
import { PlacementEnum } from "../../../../src/MusicalScore/VoiceData/Expressions/AbstractExpression";

// Issue 87 — bottom slurs. The board score (m23-26 of the user's piece) has
// 12 distinct slur starts: 8 with placement="below" (treble + bass), 4 with
// placement="above" (bass). SlurPlacementFromXML (default true) must be
// respected: below slurs render below, above slurs above. With the toggle off,
// all slurs fall back to above.

const FILE = ".issue87_bottom_slurs.musicxml";

/** XML note id of each distinct slur start → expected XML placement. */
const EXPECTED: Record<string, PlacementEnum> = {
    "n590": PlacementEnum.Below, "n631": PlacementEnum.Below,
    "n641": PlacementEnum.Below, "n651": PlacementEnum.Below,
    "n593": PlacementEnum.Below, "n633": PlacementEnum.Below,
    "n643": PlacementEnum.Below, "n654": PlacementEnum.Below,
    "n587": PlacementEnum.Above, "n628": PlacementEnum.Above,
    "n638": PlacementEnum.Above, "n648": PlacementEnum.Above,
};

function collectSlurs(osmd: OpenSheetMusicDisplay): Map<string, GraphicalSlur> {
    const byStartId: Map<string, GraphicalSlur> = new Map();
    for (const page of osmd.GraphicSheet.MusicPages) {
        for (const system of page.MusicSystems) {
            for (const staffLine of system.StaffLines) {
                for (const slur of staffLine.GraphicalSlurs) {
                    const start: string = slur.slur.StartNote.xmlId ?? "";
                    if (start && !byStartId.has(start)) {
                        byStartId.set(start, slur);
                    }
                }
            }
        }
    }
    return byStartId;
}

async function render(respectXml: boolean): Promise<Map<string, GraphicalSlur>> {
    const doc: Document = TestUtils.getScore(FILE);
    const div: HTMLElement = TestUtils.getDivElement(document);
    const osmd: OpenSheetMusicDisplay = new OpenSheetMusicDisplay(div, { autoResize: false, backend: "svg" });
    osmd.EngravingRules.SlurPlacementFromXML = respectXml;
    await osmd.load(doc);
    osmd.render();
    return collectSlurs(osmd);
}

/** Render a score and collect every slur's placement. */
async function placementsOf(file: string): Promise<PlacementEnum[]> {
    const doc: Document = TestUtils.getScore(file);
    const div: HTMLElement = TestUtils.getDivElement(document);
    const osmd: OpenSheetMusicDisplay = new OpenSheetMusicDisplay(div, { autoResize: false, backend: "svg" });
    await osmd.load(doc);
    osmd.render();
    const placements: PlacementEnum[] = [];
    for (const page of osmd.GraphicSheet.MusicPages) {
        for (const system of page.MusicSystems) {
            for (const staffLine of system.StaffLines) {
                for (const slur of staffLine.GraphicalSlurs) {
                    placements.push(slur.placement);
                }
            }
        }
    }
    return placements;
}

describe("Slur placement from XML (issue 87)", () => {
    it("below slurs render below, above slurs above (SlurPlacementFromXML=true)", async () => {
        const slurs: Map<string, GraphicalSlur> = await render(true);
        const failures: string[] = [];
        for (const [noteId, expected] of Object.entries(EXPECTED)) {
            const slur: GraphicalSlur | undefined = slurs.get(noteId);
            if (!slur) { failures.push(`${noteId}: no slur found`); continue; }
            if (slur.placement !== expected) {
                failures.push(`${noteId}: expected ${expected}, got ${slur.placement}`);
            }
        }
        expect(failures).to.deep.equal([],
            `${failures.length} slurs with wrong placement:\n` + failures.join("\n"));
    });

    it("SlurPlacementFromXML=false forces all slurs above", async () => {
        const slurs: Map<string, GraphicalSlur> = await render(false);
        const belowCount: number = [...slurs.values()].filter(
            (s) => s.placement === PlacementEnum.Below).length;
        expect(belowCount).to.equal(0,
            `${belowCount} slurs still below with SlurPlacementFromXML=false`);
    });

    it("default (SlurPlacementFromXML unset) respects XML placement", async () => {
        const doc: Document = TestUtils.getScore(FILE);
        const div: HTMLElement = TestUtils.getDivElement(document);
        const osmd: OpenSheetMusicDisplay = new OpenSheetMusicDisplay(div, { autoResize: false, backend: "svg" });
        await osmd.load(doc);
        osmd.render();
        const slurs: Map<string, GraphicalSlur> = collectSlurs(osmd);
        const failures: string[] = [];
        for (const [noteId, expected] of Object.entries(EXPECTED)) {
            const slur: GraphicalSlur | undefined = slurs.get(noteId);
            if (!slur) { failures.push(`${noteId}: no slur found`); continue; }
            if (slur.placement !== expected) {
                failures.push(`${noteId}: expected ${expected}, got ${slur.placement}`);
            }
        }
        expect(failures).to.deep.equal([],
            `${failures.length} slurs with wrong placement by default:\n` + failures.join("\n"));
    });

    it("auto-places unplaced slurs: high notes below, low notes above", async () => {
        const high: PlacementEnum[] = await placementsOf("test_slur_SlurPlacementFromXML_undefined_in_XML.musicxml");
        const low: PlacementEnum[] = await placementsOf(".issue87_auto_low.musicxml");
        expect(high.length).to.be.greaterThan(0);
        expect(high.every((p) => p === PlacementEnum.Below)).to.equal(true,
            `high-note unplaced slurs should flip below, got ${high}`);
        expect(low.length).to.be.greaterThan(0);
        expect(low.every((p) => p === PlacementEnum.Above)).to.equal(true,
            `low-note unplaced slurs should stay above, got ${low}`);
    });
});
