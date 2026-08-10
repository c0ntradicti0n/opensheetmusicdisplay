/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from "vitest";
import { GraphicalMusicSheet } from "../../../../src/MusicalScore/Graphical/GraphicalMusicSheet";
import { IXmlElement } from "../../../../src/Common/FileIO/Xml";
import { MusicSheetReader } from "../../../../src/MusicalScore/ScoreIO/MusicSheetReader";
import { VexFlowMusicSheetCalculator } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMusicSheetCalculator";
import { VexFlowStaffEntry } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowStaffEntry";
import { ClefInstruction, ClefEnum } from "../../../../src/MusicalScore/VoiceData/Instructions/ClefInstruction";

// Regression for issue 99: a mid-measure clef change whose target staff entry
// is only created later (the staff's notes follow a <backup> node) was
// hijacked as an end-of-measure clef and then dropped. It must be placed inline
// on the staff entry at its tick.
const FIXTURE: string = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Pno</part-name></score-part></part-list>
  <part id="P1">
    <measure number="72">
      <attributes>
        <divisions>120</divisions>
        <staves>2</staves>
        <time><beats>2</beats><beat-type>4</beat-type></time>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><rest/><duration>40</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <attributes><clef number="2"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>A</step><octave>6</octave></pitch><duration>80</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>F</step><octave>6</octave></pitch><duration>80</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>A</step><octave>5</octave></pitch><duration>40</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <attributes><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <backup><duration>240</duration></backup>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>40</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>40</duration><voice>5</voice><type>eighth</type><staff>2</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>80</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
      <note><pitch><step>B</step><octave>3</octave></pitch><duration>80</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

function buildGMS(): { gms: GraphicalMusicSheet, sheet: any } {
    const doc: Document = new DOMParser().parseFromString(FIXTURE, "text/xml");
    const partwise: Element = doc.getElementsByTagName("score-partwise")[0];
    const reader: MusicSheetReader = new MusicSheetReader();
    const sheet: any = reader.createMusicSheet(new IXmlElement(partwise), "issue99_fixture.musicxml");
    const calc: VexFlowMusicSheetCalculator = new VexFlowMusicSheetCalculator(reader.rules);
    const gms: GraphicalMusicSheet = new GraphicalMusicSheet(sheet, calc);
    calc.calculate();
    return { gms, sheet };
}

describe("VexFlow Measure - Inline Clef Whose Staff Entry Follows a Backup", () => {
    it("places the mid-measure treble clef inline on the staff-2 entry at its tick", () => {
        const { gms, sheet } = buildGMS();
        const measure: any = sheet.SourceMeasures[0];
        expect(measure.MeasureNumberXML).to.equal(72);
        const entries: any[] = measure.getEntriesPerStaff(1); // staff 2
        let inlineTreble: boolean = false;
        let inlineTrebleTick: number = -1;
        for (const entry of entries) {
            if (!entry?.Instructions) { continue; }
            for (const instr of entry.Instructions) {
                if (instr instanceof ClefInstruction && instr.ClefType === ClefEnum.G) {
                    inlineTreble = true;
                    inlineTrebleTick = entry.Timestamp?.RealValue ?? -1;
                }
            }
        }
        expect(inlineTreble, "staff 2 should have an inline G clef at a staff entry").to.be.true;
        expect(inlineTrebleTick).to.equal(40 / 480, "inline G clef should sit at the tick of the first treble staff-2 note");

        // graphical: the same entry carries a vfClefBefore (it will be rendered)
        let graphicalClefCount: number = 0;
        for (const vml of gms.MeasureList) {
            if (!vml) { continue; }
            for (const m of vml) {
                if (!m || !m.isVisible()) { continue; }
                if ((m as any).ParentStaff?.Id !== 2) { continue; }
                for (const se of m.staffEntries) {
                    const vfse: VexFlowStaffEntry = se as VexFlowStaffEntry;
                    if (vfse.vfClefBefore) {
                        graphicalClefCount++;
                    }
                }
            }
        }
        expect(graphicalClefCount).to.equal(1, "one in-staff clef should be created (the mid-measure treble)");
    });

    it("does not hijack the mid-measure clef as an end-of-measure clef", () => {
        const { sheet } = buildGMS();
        const measure: any = sheet.SourceMeasures[0];
        // The G clef must NOT be the end-of-measure clef. The F (bass) may be
        // stored there as a courtesy for the next measure, but never the treble.
        const last: any = measure.LastInstructionsStaffEntries?.[1];
        let endClefTypes: ClefEnum[] = [];
        if (last?.Instructions) {
            endClefTypes = last.Instructions
                .filter((i: any) => i instanceof ClefInstruction)
                .map((i: ClefInstruction) => i.ClefType);
        }
        expect(endClefTypes).to.not.include(ClefEnum.G,
            `mid-measure treble clef must not become the measure-end clef, got ${endClefTypes}`);
    });
});
