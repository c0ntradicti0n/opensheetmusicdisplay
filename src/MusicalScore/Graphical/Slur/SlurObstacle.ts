import * as VF from "vexflow";
import { StaffLine } from "../StaffLine";
import { VexFlowVoiceEntry } from "../VexFlow/VexFlowVoiceEntry";
import { unitInPixels } from "../VexFlow/VexFlowMusicSheetDrawer";
import { SlurLiftObstacle } from "./SlurLiftSolver";

/** Max sibling-obstacle slope: chord-perpendicular height ÷ chord X-span. A
 *  sibling-staff notehead counts as an obstacle only when its perpendicular reach
 *  above (Above) / below (Below) the chord is at most this fraction of the slur's
 *  horizontal span. Cross-staff-beamed runs rising into the other staff sit at a
 *  shallow slope (perp ≪ span — in the arc's path → clear); unrelated material a
 *  full staff-gap away sits at a steep slope (perp ≈ span — near-vertical → ignore,
 *  else the curve balloons toward it). Measured: John Field runs ~0.25–0.35,
 *  Dichterliebe far-staff notes ~0.6–1.3. */
export const SIBLING_MAX_SLOPE: number = 0.45;

/** An obstacle in the rendered SVG-pixel frame plus provenance metadata. */
export interface SlurObstacle extends SlurLiftObstacle {
    kind: "notehead" | "stem";
    /** false = Y reconstructed from the OSMD model (sibling staff not yet drawn). */
    trusted: boolean;
}

export interface CollectContext {
    /** The staffline whose slurs are being drawn (its VF geometry is final). */
    staffLine: StaffLine;
    startXPx: number;
    endXPx: number;
    startYPx: number;
    endYPx: number;
    above: boolean;
    /** VF notes at the slur's own endpoints — excluded from the obstacle set. */
    excludeNotes: Set<VF.StemmableNote>;
    minT: number;
    maxT: number;
    /** Cross-system first half: the end note is in the NEXT system, so this curve
     *  stops at the system break on its own staff. It must not clear sibling-staff
     *  notes in the source system — those sit a full staff-gap above the chord and
     *  balloon the arc (the slur reaches the sibling staff only in the next system). */
    crossSystemFirstHalf?: boolean;
}

/** Chord-projection t of an X/Y against the chord (same as the solver's gate). */
function chordT(x: number, y: number, ctx: CollectContext): number {
    const dx: number = ctx.endXPx - ctx.startXPx;
    const dy: number = ctx.endYPx - ctx.startYPx;
    const lenSq: number = Math.max(0.01, dx * dx + dy * dy);
    return ((x - ctx.startXPx) * dx + (y - ctx.startYPx) * dy) / lenSq;
}

/** Read one VF note's obstacle point (notehead top/bottom + slur-side stem tip). */
function noteObstaclesTrusted(
    vfNote: VF.StemmableNote, ctx: CollectContext, out: SlurObstacle[],
): void {
    const anyNote: any = vfNote as any;
    if (vfNote.isRest?.()) { return; } // rests don't need slur clearance
    if (!anyNote.getNoteHeadBounds) { return; } // ghost note
    const bounds: { yTop: number, yBottom: number } = anyNote.getNoteHeadBounds();
    const cx: number = vfNote.getAbsoluteX() + vfNote.getGlyphWidth() / 2;
    if (cx < Math.min(ctx.startXPx, ctx.endXPx) || cx > Math.max(ctx.startXPx, ctx.endXPx)) { return; }

    const headY: number = ctx.above ? bounds.yTop : bounds.yBottom;
    push(cx, headY, "notehead", true, ctx, out);

    // Stem tip only when the stem points toward the slur side.
    const dir: number = vfNote.getStemDirection?.() ?? 0;
    const towardSlur: boolean = (ctx.above && dir === 1) || (!ctx.above && dir === -1);
    if (towardSlur && anyNote.getStemExtents) {
        // getStemExtents().topY is the stem TIP for both directions
        // (innerMostNoteheadY + stemHeight·-stemDirection).
        const ext: { topY: number, baseY: number } = anyNote.getStemExtents();
        push(cx, ext.topY, "stem", true, ctx, out);
    }
}

function push(
    xPx: number, yPx: number, kind: "notehead" | "stem", trusted: boolean,
    ctx: CollectContext, out: SlurObstacle[],
): void {
    const t: number = chordT(xPx, yPx, ctx);
    if (t < ctx.minT || t > ctx.maxT) { return; }
    out.push({ xPx, yPx, kind, trusted });
}

/** Walk every VF note on a staffline in the slur's X range. */
function forEachNote(sl: StaffLine, cb: (vf: VF.StemmableNote) => void): void {
    for (const gm of sl.Measures) {
        for (const gse of gm.staffEntries) {
            if (!gse.graphicalVoiceEntries) { continue; }
            for (const gve of gse.graphicalVoiceEntries) {
                const vf: VF.StemmableNote | undefined = (gve as VexFlowVoiceEntry).vfStaveNote;
                if (vf) { cb(vf); }
            }
        }
    }
}

/** Same-instrument sibling stafflines in the parent system. */
function siblingStaffLines(sl: StaffLine): StaffLine[] {
    const system: any = sl.ParentMusicSystem;
    if (!system) { return []; }
    const myInstrument: any = sl.Measures.length > 0
        ? (sl.Measures[0] as any).parentStaff?.ParentInstrument : undefined;
    const out: StaffLine[] = [];
    for (const other of system.StaffLines as StaffLine[]) {
        if (other === sl) { continue; }
        const otherInst: any = other.Measures.length > 0
            ? (other.Measures[0] as any).parentStaff?.ParentInstrument : undefined;
        if (myInstrument && otherInst !== myInstrument) { continue; }
        out.push(other);
    }
    return out;
}

/**
 * Layout-time reservation collector: own-staff notehead/stem obstacles in a
 * staff-relative pixel frame (staff origin at 0). Reads VF geometry anchored at
 * the stave origin — `getNoteHeadBounds().yTop − stave.getY()` is the
 * deterministic notehead offset once a note is formatted, so it is valid before
 * the stave is positioned at draw. Produces the same relative geometry as the
 * draw-time absolute collector for same-staff content, so the reserved skyline
 * envelope equals the final arc. Cross-staff siblings are skipped: cross-staff
 * slurs are excluded from the reservation and sibling absolute positions are
 * not final before spacing.
 */
export function collectSlurObstaclesStaffRelative(ctx: CollectContext): SlurObstacle[] {
    const out: SlurObstacle[] = [];
    for (const gm of ctx.staffLine.Measures) {
        const mRelX: number = gm.PositionAndShape?.RelativePosition?.x ?? 0;
        for (const gse of gm.staffEntries) {
            if (!gse.graphicalVoiceEntries) { continue; }
            for (const gve of gse.graphicalVoiceEntries) {
                const vf: VF.StemmableNote | undefined = (gve as VexFlowVoiceEntry).vfStaveNote;
                if (!vf) { continue; }
                if (ctx.excludeNotes.has(vf)) { continue; }
                const anyNote: any = vf as any;
                if (vf.isRest?.()) { continue; } // rests don't need slur clearance
                if (!anyNote.getNoteHeadBounds) { continue; } // ghost note
                const stave: any = vf.getStave?.();
                if (!stave) { continue; }
                const bounds: { yTop: number, yBottom: number } = anyNote.getNoteHeadBounds();
                const x: number = vf.getAbsoluteX() + vf.getGlyphWidth() / 2 - stave.getX() + mRelX * unitInPixels;
                if (x < Math.min(ctx.startXPx, ctx.endXPx) || x > Math.max(ctx.startXPx, ctx.endXPx)) { continue; }

                const headY: number = ctx.above ? bounds.yTop : bounds.yBottom;
                push(x, headY - stave.getY(), "notehead", false, ctx, out);

                // Stem tip only when the stem points toward the slur side.
                const dir: number = vf.getStemDirection?.() ?? 0;
                const towardSlur: boolean = (ctx.above && dir === 1) || (!ctx.above && dir === -1);
                if (towardSlur && anyNote.getStemExtents) {
                    const ext: { topY: number, baseY: number } = anyNote.getStemExtents();
                    push(x, ext.topY - stave.getY(), "stem", false, ctx, out);
                }
            }
        }
    }
    return out;
}

/**
 * Collect obstacle points a slur must clear, all in the rendered SVG-pixel
 * frame (same frame as the endpoints and the SlurQualityReporter).
 *
 * Local staff: read VF geometry directly (final at draw time).
 * Cross-staff siblings: an ABOVE sibling is already drawn → trusted VF pixels;
 * a BELOW sibling's VF stave Y is not yet set → reconstruct notehead Y from the
 * OSMD model and flag it untrusted.
 */
export function collectSlurObstacles(ctx: CollectContext): SlurObstacle[] {
    const out: SlurObstacle[] = [];

    forEachNote(ctx.staffLine, (vf: VF.StemmableNote) => {
        if (ctx.excludeNotes.has(vf)) { return; }
        noteObstaclesTrusted(vf, ctx, out);
    });

    // Sibling-staff obstacles: a slur drawn on one staff can still pass over
    // notes rendered on the neighbouring staff (cross-staff-beamed runs that rise
    // into the other staff's region, e.g. bass→treble→bass in John Field). Those
    // ARE real obstacles and must be cleared. But notes a full staff-gap away
    // (unrelated material on the other staff, e.g. a flat Dichterliebe slur with
    // the sibling staff sitting far below/above) must NOT be treated as obstacles
    // or the curve balloons toward them.
    //
    // The discriminator is chord-PERPENDICULAR reach, not the isCrossed flag:
    // keep a sibling obstacle only when it sits on the slur side within
    // maxSiblingReachPx of the chord. Close notes (a few staff spaces) are in the
    // arc's path; a full staff-gap away is not.
    const cdx: number = ctx.endXPx - ctx.startXPx;
    const cdy: number = ctx.endYPx - ctx.startYPx;
    const cLen: number = Math.max(0.01, Math.hypot(cdx, cdy));
    const spanX: number = Math.max(0.01, Math.abs(cdx));
    const maxReach: number = SIBLING_MAX_SLOPE * spanX;
    const sgn: number = ctx.above ? 1 : -1;
    const nx: number = sgn * (cdy / cLen);
    const ny: number = sgn * (-cdx / cLen);
    const perpOf: (o: SlurObstacle) => number = (o: SlurObstacle): number =>
        (o.xPx - ctx.startXPx) * nx + (o.yPx - ctx.startYPx) * ny;
    const inReach: (o: SlurObstacle) => boolean = (o: SlurObstacle): boolean => {
        const h: number = perpOf(o);
        return h > 0 && h <= maxReach;
    };

    const myAbsY: number = ctx.staffLine.PositionAndShape.AbsolutePosition.y;
    if (ctx.crossSystemFirstHalf) { return out; } // first half stays on its own staff
    for (const sib of siblingStaffLines(ctx.staffLine)) {
        const sibAbsY: number = sib.PositionAndShape.AbsolutePosition.y;
        const sibAbove: boolean = sibAbsY < myAbsY;
        const before: number = out.length;
        if (sibAbove) {
            // Drawn earlier → VF stave Y is final. Read pixels directly.
            forEachNote(sib, (vf: VF.StemmableNote) => {
                if (ctx.excludeNotes.has(vf)) { return; }
                noteObstaclesTrusted(vf, ctx, out);
            });
        } else {
            // Not yet drawn → reconstruct notehead-top/bottom Y from the model.
            collectModelObstacles(sib, ctx, out);
        }
        // Keep only sibling obstacles within perpendicular reach of the chord.
        for (let i: number = out.length - 1; i >= before; i--) {
            if (!inReach(out[i])) { out.splice(i, 1); }
        }
    }
    return out;
}

/**
 * Sibling-below fallback: VF stave Y is stale, so derive obstacle X/Y from OSMD
 * model positions (staffline-relative → page px), matching how
 * calculateStartAndEnd reconstructs a cross-staff endpoint.
 */
function collectModelObstacles(sib: StaffLine, ctx: CollectContext, out: SlurObstacle[]): void {
    const sibAbsX: number = sib.PositionAndShape.AbsolutePosition.x;
    const sibAbsY: number = sib.PositionAndShape.AbsolutePosition.y;
    for (const gm of sib.Measures) {
        const mRelX: number = gm.PositionAndShape?.RelativePosition?.x ?? 0;
        const mRelY: number = gm.PositionAndShape?.RelativePosition?.y ?? 0;
        for (const gse of gm.staffEntries) {
            if (!gse.graphicalVoiceEntries) { continue; }
            const eRelX: number = gse.PositionAndShape?.RelativePosition?.x ?? 0;
            for (const gve of gse.graphicalVoiceEntries) {
                const gveRelX: number = gve.PositionAndShape?.RelativePosition?.x ?? 0;
                const gveRelY: number = gve.PositionAndShape?.RelativePosition?.y ?? 0;
                const borderTop: number = (gve.PositionAndShape as any)?.BorderTop ?? 0;
                const borderBottom: number = (gve.PositionAndShape as any)?.BorderBottom ?? 0;
                const noteXPx: number = (sibAbsX + mRelX + eRelX + gveRelX) * unitInPixels;
                const yBase: number = sibAbsY + mRelY + gveRelY;
                const yPx: number = (yBase + (ctx.above ? borderTop : borderBottom)) * unitInPixels;
                push(noteXPx, yPx, "notehead", false, ctx, out);
            }
        }
    }
}
