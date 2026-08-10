/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from "vitest";
import { GraphicalMusicSheet } from "../../../../src/MusicalScore/Graphical/GraphicalMusicSheet";
import { IXmlElement } from "../../../../src/Common/FileIO/Xml";
import { MusicSheet } from "../../../../src/MusicalScore/MusicSheet";
import { MusicSheetReader } from "../../../../src/MusicalScore/ScoreIO/MusicSheetReader";
import { VexFlowMusicSheetCalculator } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMusicSheetCalculator";
import { TestUtils } from "../../../Util/TestUtils";
import { VexFlowMeasure } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMeasure";
import { VexFlowVoiceEntry } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowVoiceEntry";
import * as VF from "vexflow";

function loadScore(path: string): { gms: GraphicalMusicSheet } {
    const score: Document = TestUtils.getScore(path);
    const partwise: Element = TestUtils.getPartWiseElement(score);
    const reader: MusicSheetReader = new MusicSheetReader();
    const calc: VexFlowMusicSheetCalculator = new VexFlowMusicSheetCalculator(reader.rules);
    const sheet: MusicSheet = reader.createMusicSheet(new IXmlElement(partwise), path);
    const gms: GraphicalMusicSheet = new GraphicalMusicSheet(sheet, calc);
    calc.calculate();
    return { gms };
}

/**
 * The voice-1 stavenotes of a measure, in reading order. A chord shares one
 * StaveNote for all its notes.
 */
function voice1StaveNotes(m: VexFlowMeasure): VF.StemmableNote[] {
    const notes: VF.StemmableNote[] = [];
    for (const se of m.staffEntries) {
        for (const gve of se.graphicalVoiceEntries) {
            const ve: any = (gve as VexFlowVoiceEntry).parentVoiceEntry;
            // skip the closing 8th rest (voice 1): rests never join beams
            if (ve?.ParentVoice?.VoiceId === 1 && !ve.Notes?.[0]?.isRest()) {
                notes.push((gve as any).vfStaveNote as VF.StemmableNote);
            }
        }
    }
    return notes;
}

describe("VexFlow Measure - chord notes join the long tuplet beam (issue #88)", () => {

    let gms: GraphicalMusicSheet;
    let treble: VexFlowMeasure;

    beforeAll(() => {
        gms = loadScore(".issue88-long-tuplet-beam-chord.musicxml").gms;
        expect(gms.MeasureList.length).to.be.greaterThanOrEqual(1);
        expect(gms.MeasureList[0].length).to.equal(2, "2 staves expected");
        treble = gms.MeasureList[0][0] as VexFlowMeasure;
    });

    it("the MusicXML beam spans all 9 sixteenths including the chord stavenotes", () => {
        // The score beams three 16th tuplets into one long beam (F4 → C7).
        // The stem notes of the chord sixteenths (n3367/n3371/n3377) carry NO
        // <beam> in the MusicXML — only their chord partners (n3368/n3372/n3378)
        // do. The chord stavenotes must still join the beam.
        const beams: VF.Beam[] = (treble as any).vfbeams[1];
        expect(beams).to.not.be.undefined;
        expect(beams.length).to.equal(1, "exactly one MusicXML beam");
        const beamNotes: VF.Note[] = beams[0].getNotes();
        expect(beamNotes.length).to.equal(9, "9 sixteenths, chords included");
        for (const note of voice1StaveNotes(treble)) {
            if (note.getCategory?.() === "ghostnotes") { continue; }
            const isBeamed: boolean = beamNotes.indexOf(note) >= 0;
            expect(isBeamed, "stavenote must be part of the long beam").to.be.true;
        }
    });

    it("no chord sixteenth is rendered as an orphan flagged note", () => {
        for (const note of voice1StaveNotes(treble)) {
            if (note.getCategory?.() === "ghostnotes") { continue; }
            const flag: any = (note as any).getFlag?.();
            expect(flag, "beamed 16th must not carry a flag").to.be.undefined;
        }
    });
});
