/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from "vitest";
import { GraphicalMusicSheet } from "../../../../src/MusicalScore/Graphical/GraphicalMusicSheet";
import { IXmlElement } from "../../../../src/Common/FileIO/Xml";
import { MusicSheet } from "../../../../src/MusicalScore/MusicSheet";
import { MusicSheetReader } from "../../../../src/MusicalScore/ScoreIO/MusicSheetReader";
import { VexFlowMusicSheetCalculator } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMusicSheetCalculator";
import { TestUtils } from "../../../Util/TestUtils";
import { VexFlowMeasure } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMeasure";
import * as VF from "vexflow";

function loadScore(path: string): { gms: GraphicalMusicSheet, calc: VexFlowMusicSheetCalculator } {
    const score: Document = TestUtils.getScore(path);
    const partwise: Element = TestUtils.getPartWiseElement(score);
    const reader: MusicSheetReader = new MusicSheetReader();
    const calc: VexFlowMusicSheetCalculator = new VexFlowMusicSheetCalculator(reader.rules);
    const sheet: MusicSheet = reader.createMusicSheet(new IXmlElement(partwise), path);
    const gms: GraphicalMusicSheet = new GraphicalMusicSheet(sheet, calc);
    calc.calculate();
    return { gms, calc };
}

/**
 * All beams that would be drawn for a measure: the MusicXML beams (vfbeams),
 * auto-generated beams and tuplet auto-beams.
 */
function allDrawnBeams(m: VexFlowMeasure): VF.Beam[] {
    const mAny: any = m as any;
    const beams: VF.Beam[] = [];
    for (const voiceID in mAny.vfbeams) {
        if (mAny.vfbeams.hasOwnProperty(voiceID)) {
            beams.push(...mAny.vfbeams[voiceID]);
        }
    }
    beams.push(...(mAny.autoVfBeams || []));
    beams.push(...(mAny.autoTupletVfBeams || []));
    return beams;
}

describe("VexFlow Measure - no duplicate cross-staff beams (issue #86)", () => {

    let gms: GraphicalMusicSheet;
    let treble: VexFlowMeasure;
    let bass: VexFlowMeasure;

    beforeAll(() => {
        const result: { gms: GraphicalMusicSheet } = loadScore(".issue86-cross-stave-beams.musicxml");
        gms = result.gms;
        expect(gms.MeasureList.length).to.be.greaterThanOrEqual(1);
        expect(gms.MeasureList[0].length).to.equal(2, "2 staves expected");
        treble = gms.MeasureList[0][0] as VexFlowMeasure;
        bass = gms.MeasureList[0][1] as VexFlowMeasure;
    });

    it("the MusicXML cross-staff beam spans all 9 sixteenths", () => {
        const beams: VF.Beam[] = (treble as any).vfbeams[1];
        expect(beams).to.not.be.undefined;
        expect(beams.length).to.equal(1, "exactly one MusicXML beam");
        expect(beams[0].getNotes().length).to.equal(9,
            "the beam runs from the bass F3 to the treble F6 (9 sixteenths)");
    });

    it("no tuplet auto-beam duplicates the long beam (issue #86)", () => {
        // The cross-staff tuplets would each get a tuplet auto-beam. When the
        // MusicXML beam already spans the same notes, that tuplet beam must be
        // skipped (or dropped) — otherwise the shared stems draw twice and a
        // short duplicate beam appears at the stave switch.
        for (const m of [treble, bass]) {
            const beams: VF.Beam[] = allDrawnBeams(m);
            for (let i: number = 0; i < beams.length; i++) {
                for (let j: number = i + 1; j < beams.length; j++) {
                    const a: VF.Note[] = beams[i].getNotes();
                    const b: VF.Note[] = beams[j].getNotes();
                    const aInB: boolean = a.length > 0 && a.every((n) => b.indexOf(n) >= 0);
                    const bInA: boolean = b.length > 0 && b.every((n) => a.indexOf(n) >= 0);
                    expect(aInB || bInA).to.equal(false,
                        `beam[${i}] (${a.length} notes) and beam[${j}] (${b.length} notes) overlap completely — duplicate beam`);
                }
            }
        }
    });

    it("the last treble note F6 (n3312) is rendered, not hidden", () => {
        let lastNoteVisible: boolean = false;
        for (const se of treble.staffEntries) {
            for (const gve of se.graphicalVoiceEntries) {
                const src: any = gve.parentVoiceEntry?.Notes?.[0];
                if (src?.xmlId === "n3312" || (src?.Pitch?.Step === "F" && src?.Pitch?.Octave === 6)) {
                    const vfNote: any = (gve as any).vfStaveNote;
                    expect(vfNote, "F6 must have a VF note").to.not.be.undefined;
                    expect(vfNote.getAttribute?.("visibility")).to.not.equal("hidden",
                        "F6 must not be hidden by OSMD");
                    lastNoteVisible = true;
                }
            }
        }
        expect(lastNoteVisible, "F6 should be found among the treble staff entries").to.be.true;
    });
});
