import { expect } from "vitest";
import {GraphicalMusicSheet} from "../../../../src/MusicalScore/Graphical/GraphicalMusicSheet";
import {IXmlElement} from "../../../../src/Common/FileIO/Xml";
import {MusicSheet} from "../../../../src/MusicalScore/MusicSheet";
import {MusicSheetReader} from "../../../../src/MusicalScore/ScoreIO/MusicSheetReader";
import {VexFlowMusicSheetCalculator} from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMusicSheetCalculator";
import {TestUtils} from "../../../Util/TestUtils";
import {VexFlowMeasure} from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMeasure";
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
 * Voice-1 beams that would be drawn for a measure: explicit MusicXML beams
 * (vfbeams) plus the auto-tuplet fallback. The rest-led tuplet chords carry
 * their <beam> tags on the chord partner notes, so since the reader honors
 * those, the beams land in vfbeams[1] (the auto-tuplet fallback only kicks in
 * for notes that no explicit beam covers).
 */
function voice1DrawnBeams(m: VexFlowMeasure): VF.Beam[] {
    const mAny: any = m as any;
    return [...(mAny.vfbeams[1] || []), ...(mAny.autoTupletVfBeams || [])];
}

describe("VexFlow Measure - Rests in cross-staff tuplets (issue #83)", () => {

    let bassM78: VexFlowMeasure;
    let bassM79: VexFlowMeasure;

    beforeAll(() => {
        const { gms } = loadScore(".issue83-rests-cross-stave-beams.musicxml");
        expect(gms.MeasureList.length).to.be.greaterThanOrEqual(5, "7 measures expected");
        // 4th and 5th measures of the piece = MusicXML measures 78 and 79.
        bassM78 = gms.MeasureList[3][1] as VexFlowMeasure;
        bassM79 = gms.MeasureList[4][1] as VexFlowMeasure;
    });

    it("the rest-led tuplets still get beamed over their two chords", () => {
        for (const measure of [bassM78, bassM79]) {
            const beams: VF.Beam[] = voice1DrawnBeams(measure);
            expect(beams.length).to.equal(2, "2 tuplets per measure = 2 beams");
            for (let i: number = 0; i < beams.length; i++) {
                const notes: VF.Note[] = beams[i].getNotes();
                expect(notes.length).to.equal(2, `beam[${i}] should connect the 2 chords only`);
            }
        }
    });

    it("no beam should contain a rest", () => {
        for (const measure of [bassM78, bassM79]) {
            const mAny: any = measure as any;
            const allBeams: VF.Beam[] = [
                ...(mAny.autoTupletVfBeams || []),
                ...(mAny.autoVfBeams || []),
            ];
            for (const voiceID in mAny.vfbeams) {
                if (mAny.vfbeams.hasOwnProperty(voiceID)) {
                    allBeams.push(...mAny.vfbeams[voiceID]);
                }
            }
            for (const beam of allBeams) {
                for (const note of beam.getNotes()) {
                    expect(note.isRest()).to.equal(false,
                        "a beam must never reach into the upper stave's rest space");
                }
            }
        }
    });

    it("rest-led tuplet beams should NOT be registered as cross-staff", () => {
        for (const measure of [bassM78, bassM79]) {
            const mAny: any = measure as any;
            const siblingMap: Map<VF.Beam, VexFlowMeasure> = mAny.crossStaffBeamSiblings;
            expect(siblingMap.size).to.equal(0,
                "an upper stave holding only rests must not turn the beam cross-staff");
            for (const beam of mAny.autoTupletVfBeams) {
                expect((beam as any).renderOptions.flatBeams).to.not.equal(true,
                    "local beam must not be cross-staff positioned");
            }
        }
    });

    it("same-staff rest-led tuplets (measures 80/81) also skip the rest when beaming", () => {
        const { gms } = loadScore(".issue83-rests-cross-stave-beams.musicxml");
        for (const measureIdx of [5, 6]) {
            const treble: VexFlowMeasure = gms.MeasureList[measureIdx][0] as VexFlowMeasure;
            const beams: VF.Beam[] = voice1DrawnBeams(treble);
            expect(beams.length).to.equal(2, `measure ${measureIdx + 1} should have 2 beams`);
            for (const beam of beams) {
                const notes: VF.Note[] = beam.getNotes();
                expect(notes.length).to.equal(2,
                    "same-staff beam connects the 2 chords only, rest excluded");
                for (const note of notes) {
                    expect(note.isRest()).to.equal(false, "no rest in beam");
                }
            }
        }
    });

    it("a genuine cross-staff beam (measure 76) is still detected", () => {
        const { gms } = loadScore(".issue83-rests-cross-stave-beams.musicxml");
        let crossStaffCount: number = 0;
        for (const measure of gms.MeasureList[1]) {
            const siblingMap: Map<VF.Beam, VexFlowMeasure> = (measure as any).crossStaffBeamSiblings;
            crossStaffCount += siblingMap.size;
            for (const beam of siblingMap.keys()) {
                for (const note of beam.getNotes()) {
                    expect(note.isRest()).to.equal(false, "genuine cross-staff beam has no rest");
                }
            }
        }
        expect(crossStaffCount).to.be.greaterThan(0,
            "measure 76 has real notes on both staves — its cross-staff beams must survive");
    });
});
