/* eslint-disable @typescript-eslint/typedef */
import { expect } from "vitest";
import { PointF2D } from "../../../src/Common/DataObjects/PointF2D";
import { solveSlurLift, SlurLiftObstacle, SlurLiftOptions } from "../../../src/MusicalScore/Graphical/Slur/SlurLiftSolver";

const BASE: SlurLiftOptions = {
    minT: 0.25, maxT: 0.75, k: 0.9, d: 0.2, tangentAngleDeg: 20,
    marginPx: 5, slackPx: 15, maxBowRatio: 0.5, above: true,
};

/** Perpendicular apex height of the returned curve, measured off the chord. */
function apexPerp(start: PointF2D, end: PointF2D, r: { c1: PointF2D, c2: PointF2D }, above: boolean): number {
    const dx = end.x - start.x, dy = end.y - start.y;
    const len = Math.max(0.01, Math.sqrt(dx * dx + dy * dy));
    const ux = dx / len, uy = dy / len;
    const sign = above ? 1 : -1;
    const px = sign * uy, py = sign * -ux;
    let maxH = 0;
    for (let i = 0; i <= 100; i++) {
        const t = i / 100, t1 = 1 - t;
        const x = t1 * t1 * t1 * start.x + 3 * t1 * t1 * t * r.c1.x + 3 * t1 * t * t * r.c2.x + t * t * t * end.x;
        const y = t1 * t1 * t1 * start.y + 3 * t1 * t1 * t * r.c1.y + 3 * t1 * t * t * r.c2.y + t * t * t * end.y;
        const h = (x - start.x) * px + (y - start.y) * py;
        if (h > maxH) { maxH = h; }
    }
    return maxH;
}

describe("SlurLiftSolver", () => {
    const start = new PointF2D(0, 0);
    const end = new PointF2D(100, 0);

    it("no obstacles → positive natural bow, CPs above the chord (Above)", () => {
        const r = solveSlurLift(start, end, [], BASE);
        expect(r.c1.y).lessThan(0); // Above bows to -Y
        expect(r.c2.y).lessThan(0);
        expect(r.bowPx).greaterThan(0);
    });

    it("mid-span obstacle → curve clears it by ≥ margin", () => {
        const obs: SlurLiftObstacle[] = [{ xPx: 50, yPx: -20 }]; // 20px above chord
        const r = solveSlurLift(start, end, obs, BASE);
        expect(apexPerp(start, end, r, true)).greaterThan(20); // clears the 20px obstacle
    });

    it("edge obstacle (t≈0.25) → clears by margin without ballooning past cap", () => {
        const obs: SlurLiftObstacle[] = [{ xPx: 25, yPx: -30 }];
        const r = solveSlurLift(start, end, obs, BASE);
        const apex = apexPerp(start, end, r, true);
        expect(apex).greaterThan(30);           // cleared
        expect(apex).lessThan(30 + 5 + 15 + 5); // within obstacle+margin+slack band, not amplified
    });

    it("obstacle outside the t-window is ignored", () => {
        const near = solveSlurLift(start, end, [{ xPx: 5, yPx: -40 }], BASE); // t=0.05
        const bare = solveSlurLift(start, end, [], BASE);
        expect(Math.abs(near.bowPx - bare.bowPx)).lessThan(0.01);
    });

    it("far-side obstacle (below chord for Above) is ignored", () => {
        const r = solveSlurLift(start, end, [{ xPx: 50, yPx: 40 }], BASE);
        const bare = solveSlurLift(start, end, [], BASE);
        expect(Math.abs(r.bowPx - bare.bowPx)).lessThan(0.01);
    });

    it("Below placement bows to +Y and clears a below-chord obstacle", () => {
        const opts = { ...BASE, above: false };
        const r = solveSlurLift(start, end, [{ xPx: 50, yPx: 20 }], opts);
        expect(r.c1.y).greaterThan(0);
        expect(apexPerp(start, end, r, false)).greaterThan(20);
    });

    it("degenerate chord does not blow up", () => {
        const r = solveSlurLift(new PointF2D(0, 0), new PointF2D(0.1, 0), [], BASE);
        expect(Number.isFinite(r.c1.x) && Number.isFinite(r.c1.y)).to.equal(true);
        expect(Number.isFinite(r.c2.x) && Number.isFinite(r.c2.y)).to.equal(true);
    });

    it("tall obstacle capped by maxBowRatio ceiling on a long slur", () => {
        const longEnd = new PointF2D(400, 0);
        // Obstacle so tall the clearance requirement would exceed 0.5·chord=200.
        const r = solveSlurLift(start, longEnd, [{ xPx: 100, yPx: -300 }], BASE);
        const apex = apexPerp(start, longEnd, r, true);
        // Ratio ceiling only trims when it still clears the obstacle; here obstacle
        // (300) > ceiling (200) so clearance floor wins — must still clear.
        expect(apex).greaterThan(300);
    });

    it("steep chord: obstacle-free bow stays bounded by ratio ceiling", () => {
        const steepEnd = new PointF2D(80, -60); // steep rising chord
        const r = solveSlurLift(start, steepEnd, [], BASE);
        const len = Math.sqrt(80 * 80 + 60 * 60); // 100
        expect(apexPerp(start, steepEnd, r, true)).lessThan(0.5 * len + 1);
    });

    it("translation-invariant: shifting all inputs yields the same local curve", () => {
        // The layout-time reservation (staff-relative frame) and the draw-time
        // solve (absolute frame) must produce the identical local bezier for the
        // same relative geometry — this is what keeps the reserved skyline band
        // equal to the final arc (no over/under-spacing).
        const obs: SlurLiftObstacle[] = [
            { xPx: 30, yPx: -15 }, { xPx: 55, yPx: -25 }, { xPx: 75, yPx: -10 },
        ];
        const a = solveSlurLift(new PointF2D(0, 0), new PointF2D(100, 0), obs, BASE);
        const dx: number = 37.5, dy: number = -12.25; // arbitrary shift (staff y offset)
        const shiftedStart = new PointF2D(dx, dy);
        const shiftedEnd = new PointF2D(100 + dx, dy);
        const shiftedObs: SlurLiftObstacle[] = obs.map(o => ({ xPx: o.xPx + dx, yPx: o.yPx + dy }));
        const b = solveSlurLift(shiftedStart, shiftedEnd, shiftedObs, BASE);
        for (const [an, bn] of [[a.c1, b.c1], [a.c2, b.c2]] as Array<[PointF2D, PointF2D]>) {
            expect(bn.x - shiftedStart.x).closeTo(an.x, 1e-9);
            expect(bn.y - shiftedStart.y).closeTo(an.y, 1e-9);
        }
    });
});
