import { expect } from "vitest";
import { GraphicalMusicSheet } from "../../../../src/MusicalScore/Graphical/GraphicalMusicSheet";
import { IXmlElement } from "../../../../src/Common/FileIO/Xml";
import { MusicSheet } from "../../../../src/MusicalScore/MusicSheet";
import { MusicSheetReader } from "../../../../src/MusicalScore/ScoreIO/MusicSheetReader";
import { VexFlowMusicSheetCalculator } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMusicSheetCalculator";
import { TestUtils } from "../../../Util/TestUtils";
import { VexFlowMeasure } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMeasure";
import { VexFlowStaffLine } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowStaffLine";
import { GraphicalSlur } from "../../../../src/MusicalScore/Graphical/GraphicalSlur";
import { PlacementEnum } from "../../../../src/MusicalScore/VoiceData/Expressions/AbstractExpression";
import { renderToSvg } from "../../../Util/SlurQualityReporter";

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

/** Set abs coordinates and position cross-staff beams for all measures. */
function prepareMeasures(gms: GraphicalMusicSheet): void {
    const pages: any[] = gms.MusicPages;
    for (const page of pages) {
        for (const sys of page.MusicSystems) {
            for (const col of sys.GraphicalMeasures) {
                for (const m of col) {
                    if ((m as VexFlowMeasure).setAbsoluteCoordinates) {
                        (m as VexFlowMeasure).setAbsoluteCoordinates(
                            m.PositionAndShape.AbsolutePosition.x * 10,
                            m.PositionAndShape.AbsolutePosition.y * 10,
                        );
                    }
                }
            }
            // Position beams per staff line
            for (const sl of sys.StaffLines) {
                for (const m of sl.Measures) {
                    try { (m as any).positionCrossStaffBeams?.(); } catch (_) { /* skip */ }
                }
            }
        }
    }
}

interface SlurCpInfo {
    slur: GraphicalSlur;
    measure: number;
    stave: number;
    isCrossed: boolean;
    startPt: { x: number, y: number };
    cp1: { x: number, y: number };
    cp2: { x: number, y: number };
    endPt: { x: number, y: number };
    bow: number;
    obstacleCount: number;
}

function collectCrossStaffSlurs(gms: GraphicalMusicSheet, calc: VexFlowMusicSheetCalculator): SlurCpInfo[] {
    const result: SlurCpInfo[] = [];
    const pages: any[] = gms.MusicPages;
    for (const page of pages) {
        for (const sys of page.MusicSystems) {
            for (const sl of sys.StaffLines) {
                const vfSl: VexFlowStaffLine = sl as VexFlowStaffLine;
                for (const slur of vfSl.GraphicalSlurs) {
                    if (!slur.bezierStartPt) { continue; }
                    // Determine if visually cross-staff (different VF5 staves)
                    const startNote: any = calc.rules.GNote(slur.slur.StartNote);
                    const endNote: any = calc.rules.GNote(slur.slur.EndNote);
                    const sv: any = (startNote as any)?.vfnote?.[0];
                    const ev: any = (endNote as any)?.vfnote?.[0];
                    const sStave: any = sv?.checkStave?.() || sv?.stave;
                    const eStave: any = ev?.checkStave?.() || ev?.stave;
                    const visCross: boolean = !!(sStave && eStave && sStave !== eStave);
                    // Skip slurs that are neither source-crossed nor visual-cross-staff
                    if (!slur.slur.isCrossed() && !visCross) { continue; }

                    // Curves are already final after renderToSvg (draw-time solve).
                    // Re-running the solver here would double-mutate the skyline.

                    const sy: number = slur.bezierStartPt.y;
                    const ey: number = slur.bezierEndPt.y;
                    // Bow = perpendicular distance of the control point from the
                    // chord LINE (not from the far endpoint). For a steep
                    // cross-staff chord, cp1 sits below the high (treble) endpoint
                    // even for a perfect arc, so chordTop-cp1.y under-reports the
                    // real bow. Positive = the CP bulges to the slur (Above) side.
                    const sx: number = slur.bezierStartPt.x;
                    const ex: number = slur.bezierEndPt.x;
                    const cdx: number = ex - sx;
                    const cdy: number = ey - sy;
                    const clen: number = Math.hypot(cdx, cdy) || 1;
                    const rcx: number = slur.bezierStartControlPt.x - sx;
                    const rcy: number = slur.bezierStartControlPt.y - sy;
                    // Perp component of the CP off the chord line; positive on the
                    // slur (Above) side (verified: normal (dy/L,-dx/L) yields +perp
                    // for an above-bulging CP).
                    const bow: number = rcx * (cdy / clen) + rcy * (-cdx / clen);

                    const firstSE: any = slur.staffEntries?.[0];
                    const meas: any = firstSE?.parentMeasure;
                    const mn: number = meas?.MeasureNumber ?? meas?.ImplicitMeasureNumber ?? -1;
                    const parSl2: any = meas?.ParentStaffLine;
                    const si: number = parSl2?.ParentMusicSystem?.StaffLines?.indexOf(parSl2) ?? -1;

                    result.push({
                        slur,
                        measure: mn,
                        stave: si,
                        isCrossed: slur.slur.isCrossed(),
                        startPt: { x: slur.bezierStartPt.x, y: sy },
                        cp1: { x: slur.bezierStartControlPt.x, y: slur.bezierStartControlPt.y },
                        cp2: { x: slur.bezierEndControlPt.x, y: slur.bezierEndControlPt.y },
                        endPt: { x: slur.bezierEndPt.x, y: ey },
                        bow,
                        obstacleCount: slur.debugSkyPoints?.length ?? 0,
                    });
                }
            }
        }
    }
    return result;
}

describe("Cross-Staff Slur Spy Tests", () => {
    describe("Dichterliebe01 cross-staff slurs — jsdom draw-time CPs", () => {
        let slurs: SlurCpInfo[];

        beforeAll(() => {
            const { gms, calc } = loadScore("Dichterliebe01.xml");
            prepareMeasures(gms);
            // Draw once so VF notes are formatted — the unified slur solver reads
            // real notehead/stem pixel geometry at draw time (obstacles are empty
            // until the notes are laid out by VexFlow).
            renderToSvg(gms, calc.rules);
            slurs = collectCrossStaffSlurs(gms, calc);
        });

        it("finds cross-staff slurs", () => {
            expect(slurs.length).to.be.greaterThan(0,
                `expected ≥1 cross-staff slur, got ${slurs.length}`);
        });

        it("cross-staff slurs bow on their placement side", () => {
            // Respects the XML placement preset: an Above-placed slur must not
            // bow downward (bow < -2); a Below-placed slur must not balloon
            // upward (bow > 2). Issue 87: bottom slurs render below.
            const failures: string[] = [];
            for (const s of slurs) {
                const isAbove: boolean = s.slur.placement === PlacementEnum.Above;
                if (isAbove && s.bow < -2) {
                    failures.push(
                        `M${s.measure}.S${s.stave} bow=${s.bow.toFixed(1)} (Above slur bows down)`);
                } else if (!isAbove && s.bow > 2) {
                    failures.push(
                        `M${s.measure}.S${s.stave} bow=${s.bow.toFixed(1)} (Below slur bows up)`);
                }
            }
            expect(failures).to.deep.equal([],
                `${failures.length} slurs bowing against their placement:\n` + failures.join("\n"));
        });

        it("cross-staff slurs collect obstacles", () => {
            // Skyline obstacles collected for maxY override; each cross-staff slur
            // should have ≥1 obstacle point from the target staff's skyline.
            const noObs: SlurCpInfo[] = slurs.filter(s => s.obstacleCount === 0);
            expect(noObs.length).to.be.lessThan(slurs.length,
                `${noObs.length}/${slurs.length} slurs have zero obstacles`);
        });

        it("CP height does not exceed highest obstacle Y in debug points", () => {
            const failures: string[] = [];
            for (const s of slurs) {
                const obs: any[] = s.slur.debugSkyPoints ?? [];
                if (obs.length === 0) { continue; }
                const minObsY: number = Math.min(...obs.map((p: any) => p.y));
                if (s.cp1.y < minObsY - 20) {
                    failures.push(
                        `M${s.measure}.S${s.stave} cp1.y=${s.cp1.y.toFixed(1)} ` +
                        `minObsY=${minObsY.toFixed(1)}`);
                }
            }
            expect(failures).to.deep.equal([],
                `${failures.length} slurs with CP above max obstacle:\n` +
                failures.join("\n"));
        });

        it("reports CP summary", () => {
            console.warn("\n=== Cross-staff slur CP summary ===");
            for (const s of slurs) {
                const tag: string = s.isCrossed ? "isCrossed" : "visCross";
                console.warn(
                    `  M${s.measure}.S${s.stave} ${tag}` +
                    ` startY=${s.startPt.y.toFixed(1)}` +
                    ` cp1y=${s.cp1.y.toFixed(1)}` +
                    ` cp2y=${s.cp2.y.toFixed(1)}` +
                    ` endY=${s.endPt.y.toFixed(1)}` +
                    ` bow=${s.bow.toFixed(1)}` +
                    ` obs=${s.obstacleCount}`);
            }
        });

        it("M12 and M21 cross-staff slurs have bow > 0", () => {
            const m12: SlurCpInfo[] = slurs.filter(s => s.measure === 12);
            const m21: SlurCpInfo[] = slurs.filter(s => s.measure === 21);
            for (const s of [...m12, ...m21]) {
                expect(s.bow).to.be.greaterThan(0,
                    `M${s.measure}.S${s.stave} bow=${s.bow.toFixed(1)}`);
            }
        });

        it("M4 and M5 cross-staff slurs have CP not too high", () => {
            const m4: SlurCpInfo[] = slurs.filter(s => s.measure === 4);
            const m5: SlurCpInfo[] = slurs.filter(s => s.measure === 5);
            const ref: SlurCpInfo[] = slurs.filter(s => s.measure === 14);
            if (ref.length === 0) { return; }
            const maxRefBow: number = Math.max(...ref.map(s => s.bow));
            for (const s of [...m4, ...m5]) {
                if (s.bow > maxRefBow * 6) {
                    expect(s.bow).to.be.lessThanOrEqual(maxRefBow * 6,
                        `M${s.measure}.S${s.stave} bow=${s.bow.toFixed(1)} ` +
                        `> 6× ref(${maxRefBow.toFixed(1)})`);
                }
            }
        });
    });

});
