/* eslint-disable @typescript-eslint/typedef */
import { expect } from "vitest";
import { slurQualityForPath } from "../../../Util/SlurQualityReporter";
import { MusicSheetReader } from "../../../../src/MusicalScore/ScoreIO/MusicSheetReader";
import { VexFlowMusicSheetCalculator } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMusicSheetCalculator";

const SCORES: Array<{ name: string, path: string }> = [
    { name: "John Field", path: ".john-field-piano-concerto-7_m318-323.mxl" },
    { name: "Dichterliebe", path: "Dichterliebe01.xml" },
    { name: "Beethoven", path: "Beethoven_AnDieFerneGeliebte.xml" },
    { name: "Liszt", path: ".Franz_Liszt_Transcendental_Etude_No.10_in_F_minor_Appassionata.mxl" },
];

describe("SlurQuality ground-truth report", () => {
    for (const cfg of SCORES) {
        describe(cfg.name, () => {
            let reports: Awaited<ReturnType<typeof slurQualityForPath>>["reports"];

            beforeAll(async () => {
                const reader: MusicSheetReader = new MusicSheetReader();
                const calc: VexFlowMusicSheetCalculator = new VexFlowMusicSheetCalculator(reader.rules);
                const out = await slurQualityForPath(cfg.path, calc.rules);
                reports = out.reports;
            }, 180000);

            it("produces a report per slur", () => {
                expect(reports.length, `${cfg.name}: expected ≥1 slur`).greaterThan(0);
            });

            it("reports sane, finite coordinates and bow metrics", () => {
                const bad: string[] = [];
                for (const r of reports) {
                    // chord/bow must always be finite; clearance may be +Infinity
                    // (no obstacles inside the t-window = clears everything).
                    if (!Number.isFinite(r.chordLenPx) || !Number.isFinite(r.bowPx)) {
                        bad.push(`${r.id} non-finite metric`);
                    }
                    if (r.chordLenPx <= 0) { bad.push(`${r.id} chordLen=${r.chordLenPx}`); }
                    if (r.bowPx < 0) { bad.push(`${r.id} negative bow`); }
                    if (!Number.isFinite(r.clearancePx) && r.clearancePx !== Infinity) {
                        bad.push(`${r.id} non-finite clearance`);
                    }
                    // Untrusted slurs (backwards span, missing ids, ...) are
                    // already flagged by the self-check; don't double-fail them.
                    if (r.trusted && (r.bowRatio < 0 || r.bowRatio > 2.0)) {
                        bad.push(`${r.id} bowRatio=${r.bowRatio.toFixed(3)} out of sane range`);
                    }
                }
                expect(bad, `${bad.length} slur reports with absurd metrics`).to.deep.equal([]);
            });

            it("reports the shared clearable t-window", () => {
                for (const r of reports) {
                    expect(r.tMin).to.equal(0.25);
                    expect(r.tMax).to.equal(0.75);
                    if (r.obstacleCount > 0) {
                        expect(r.clearanceT >= r.tMin && r.clearanceT <= r.tMax).to.equal(true);
                    }
                }
            });

            it("flags untrusted input instead of silently reporting", () => {
                // Either id-verified (svg frame) or explicitly flagged untrusted.
                for (const r of reports) {
                    if (!r.trusted && r.frame !== "osmd-model") {
                        throw new Error(`${cfg.name}/${r.id}: untrusted but frame=${r.frame}`);
                    }
                    if (r.frame === "osmd-model") {
                        expect(r.trusted).to.equal(false);
                    }
                }
            });

            it("keeps balloon share bounded", () => {
                // Cross-staff corpus has a known heavy tail; the sweep's optimum
                // should pull this down. Bound catches gross regressions.
                const balloons: number = reports.filter(r => r.balloon).length;
                expect(balloons / reports.length, `${cfg.name}: ${balloons}/${reports.length} balloons`).lessThan(0.8);
            });
        });
    }
});
