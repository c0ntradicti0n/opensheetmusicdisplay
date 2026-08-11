/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from "vitest";
import { GraphicalMusicSheet } from "../../../../src/MusicalScore/Graphical/GraphicalMusicSheet";
import { IXmlElement } from "../../../../src/Common/FileIO/Xml";

import { MusicSheetReader } from "../../../../src/MusicalScore/ScoreIO/MusicSheetReader";
import { VexFlowMusicSheetCalculator } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMusicSheetCalculator";
import { TestUtils } from "../../../Util/TestUtils";
import { VexFlowMeasure } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMeasure";
import { VexFlowVoiceEntry } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowVoiceEntry";

interface NotePos {
  noteX: number;    // sn.getX() = tickContext.getX() + xShift (no centering)
  absX: number;     // sn.getAbsoluteX() — includes centerXShift for rests
  tcX: number;       // tickContext.getX() — raw tick position
  xShift: number;
  isRest: boolean;
  isCenterAligned: boolean;
  keys: string;
  staff: number;
  measure: number;
}

function checkAlignment(gms: GraphicalMusicSheet): { misalignedCount: number, checkedCount: number, allPositions: NotePos[] } {
  const allPositions: NotePos[] = [];
  let misalignedCount: number = 0;
  let checkedCount: number = 0;

  for (const vml of gms.MeasureList) {
    if (!vml) {continue;}
    const visibleMeasures: VexFlowMeasure[] = vml.filter(
      (m) => m?.isVisible()
    ) as VexFlowMeasure[];
    if (visibleMeasures.length < 2) {continue;}

    // Group notes by tickContext.getX() (rounded to 2 decimals).
    // tickContext.getX() is the formatter-assigned base position — same logical
    // time across staves should land at the same tickContext X if the formatter
    // aligns them correctly.
    const tickGroups: Map<number, NotePos[]> = new Map();
    for (const measure of visibleMeasures) {
      for (const se of measure.staffEntries) {
        if (!se) {continue;}
        for (const gve of se.graphicalVoiceEntries) {
          const vfve: VexFlowVoiceEntry = gve as VexFlowVoiceEntry;
          if (!vfve.vfStaveNote) {continue;}
          const sn: any = vfve.vfStaveNote;
          const tcX: number = sn.tickContext?.getX() ?? 0;
          const noteX: number = sn.getX?.() ?? -1;
          const absX: number = sn.getAbsoluteX?.() ?? -1;
          const xShift: number = typeof sn.getXShift === "function" ? sn.getXShift() : (sn.xShift ?? 0);
          const isCenterAligned: boolean = sn.isCenterAligned?.() ?? false;
          const tcXRounded: number = Math.round(tcX * 100) / 100;
          const pos: NotePos = {
            noteX: Math.round(noteX * 100) / 100,
            absX: Math.round(absX * 100) / 100,
            tcX,
            xShift: Math.round(xShift * 100) / 100,
            isRest: sn.isRest?.() ?? false,
            isCenterAligned,
            keys: sn.getKeys?.()?.join(",") ?? "?",
            staff: measure.ParentStaff?.Id ?? -1,
            measure: measure.MeasureNumber,
          };
          if (!tickGroups.has(tcXRounded)) {
            tickGroups.set(tcXRounded, []);
          }
          tickGroups.get(tcXRounded)!.push(pos);
          allPositions.push(pos);
        }
      }
    }

    for (const [tcX, entries] of tickGroups) {
      if (entries.length < 2) {continue;}
      const crossStaffEntries: NotePos[] = entries.filter(e => e.staff !== entries[0].staff);
      if (crossStaffEntries.length === 0) {continue;}
      checkedCount++;
      const ref: NotePos = entries[0];

      // Log group details for diagnostics
      const staffs: number[] = [...new Set(entries.map(e => e.staff))].sort();
      console.log(
        `[ALIGN] m${ref.measure} tcX=${tcX} staffs=[${staffs}] ` +
        `noteX=[${entries.map(e => e.noteX.toFixed(1)).join(",")}] ` +
        `xShift=[${entries.map(e => e.xShift.toFixed(1)).join(",")}] ` +
        `keys=${entries.map(e => e.keys).join("|")}`
      );

      for (const entry of crossStaffEntries) {
        // Voice alignment is the formatter-assigned base (tickContext X).
        // Per-note xShift is legitimate collision avoidance for same-tick
        // cross-voice notes on the same staff line (e.g. F3 vs F#3 sharing a
        // line — issue 113), so it must not count as a misalignment.
        // Compare base = getX() - xShift = tickContext.getX().
        const baseXDiff: number = Math.abs((entry.noteX - entry.xShift) - (ref.noteX - ref.xShift));

        // Flag extreme xShift (beyond cross-voice collision-avoidance scale)
        if (Math.abs(entry.xShift) > 30 || Math.abs(ref.xShift) > 30) {
          console.log(
            `EXTREME_XSHIFT m${ref.measure} tcX=${tcX}: ` +
            `xShift=${ref.xShift} vs ${entry.xShift} ` +
            `noteX=${ref.noteX} vs ${entry.noteX} ` +
            `keys=${ref.keys} vs ${entry.keys}`
          );
          misalignedCount++;
        }

        // Cross-staff notes at same tick position must share the formatter's
        // base X (tickContext X). Tolerance of 2px for rounding.
        if (baseXDiff > 2) {
          console.log(
            `MISALIGN m${ref.measure} tcX=${tcX}: ` +
            `base diff=${baseXDiff.toFixed(1)} ` +
            `(xShift=${ref.xShift.toFixed(1)} vs ${entry.xShift.toFixed(1)}) ` +
            `keys=${ref.keys}|${entry.keys}`
          );
          misalignedCount++;
        }
      }
    }
  }

  return { misalignedCount, checkedCount, allPositions };
}

describe("VexFlow Measure - Voice Alignment Across Staves", () => {
  it("Should align notes across staves in full score", () => {
    const path: string = "OSMD_Function_Test_Voice_Alignment.musicxml";
    const score: any = TestUtils.getScore(path);
    expect(score).to.not.be.undefined;
    const partwise: any = TestUtils.getPartWiseElement(score);
    expect(partwise).to.not.be.undefined;
    const reader: MusicSheetReader = new MusicSheetReader();
    const calc: VexFlowMusicSheetCalculator = new VexFlowMusicSheetCalculator(reader.rules);
    const sheet: any = reader.createMusicSheet(new IXmlElement(partwise), path);
    const gms: GraphicalMusicSheet = new GraphicalMusicSheet(sheet, calc);
    calc.calculate();

    expect(gms.MeasureList.length).to.be.greaterThan(0);

    // Cross-voice collision avoidance (VexFlow Formatter.resolveCrossVoiceCollisions)
    // may apply xShift to same-staff notes that share a line at the same tick
    // (e.g. F3 + F#3). That is legitimate and does not break voice alignment,
    // which is defined by the formatter's base (tickContext X).
    const { misalignedCount, checkedCount }: { misalignedCount: number, checkedCount: number } = checkAlignment(gms);
    expect(misalignedCount).to.be.at.most(1,
      `${misalignedCount} out of ${checkedCount} cross-staff note groups have misaligned base X positions (>2px)`);
  });

  it("Should align voices in reduced grand staff score", () => {
    const path: string = "OSMD_Function_Test_Voice_Alignment_reduced.musicxml";
    const score: any = TestUtils.getScore(path);
    expect(score).to.not.be.undefined;
    const partwise: any = TestUtils.getPartWiseElement(score);
    expect(partwise).to.not.be.undefined;
    const reader: MusicSheetReader = new MusicSheetReader();
    const calc: VexFlowMusicSheetCalculator = new VexFlowMusicSheetCalculator(reader.rules);
    const sheet: any = reader.createMusicSheet(new IXmlElement(partwise), path);
    const gms: GraphicalMusicSheet = new GraphicalMusicSheet(sheet, calc);
    calc.calculate();

    expect(gms.MeasureList.length).to.be.greaterThan(0);

    const { misalignedCount, checkedCount }: { misalignedCount: number, checkedCount: number } = checkAlignment(gms);
    expect(misalignedCount).to.equal(0,
      `${misalignedCount} out of ${checkedCount} cross-staff note groups have misaligned base X positions (>2px)`);
  });

  it("Should keep reference staff (treble/green) xShift unchanged while aligning colored score", () => {
    const path: string = "OSMD_Function_Test_Voice_Alignment_colored.musicxml";
    const score: any = TestUtils.getScore(path);
    expect(score).to.not.be.undefined;
    const partwise: any = TestUtils.getPartWiseElement(score);
    expect(partwise).to.not.be.undefined;
    const reader: MusicSheetReader = new MusicSheetReader();
    const calc: VexFlowMusicSheetCalculator = new VexFlowMusicSheetCalculator(reader.rules);
    const sheet: any = reader.createMusicSheet(new IXmlElement(partwise), path);
    const gms: GraphicalMusicSheet = new GraphicalMusicSheet(sheet, calc);
    calc.calculate();

    expect(gms.MeasureList.length).to.be.greaterThan(0);

    const { misalignedCount, checkedCount }: { misalignedCount: number, checkedCount: number } = checkAlignment(gms);
    expect(misalignedCount).to.be.at.most(1,
      `${misalignedCount} out of ${checkedCount} cross-staff note groups have misaligned base X positions (>2px)`);
  });
});
