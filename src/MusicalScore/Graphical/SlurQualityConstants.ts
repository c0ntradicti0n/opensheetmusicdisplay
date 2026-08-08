/**
 * Single source of truth for slur-quality numbers shared between the
 * curve algorithm (GraphicalSlur.calculateCurve) and the ground-truth
 * reporter (test/Util/SlurQualityReporter.ts). Import these — never
 * hard-code a second copy — so clearance and collision-check cannot drift.
 */

/** Clearable t-window: obstacles nearer than this to the chord endpoints
 *  are ignored (a bezier is nearly flat there and cannot bow them away). */
export const SLUR_CLEARABLE_MIN_T: number = 0.25;
export const SLUR_CLEARABLE_MAX_T: number = 0.75;

/** Reference bow: a normal slur's bow/chord ratio (bow height over chord
 *  length, both in the same unit). Measured baseline ~0.10 (cpY/span). */
export const SLUR_REFERENCE_BOW_RATIO: number = 0.10;

/** Balloon threshold: bowRatio above this many times the reference counts
 *  as an over-inflated curve. 0.30 ≈ cpY/span 0.40 (the historical flag). */
export const SLUR_BALLOON_BOW_RATIO: number = 0.30;

/** Pixel-space collision tolerance: a bezier clearing an obstacle by less
 *  than this many SVG pixels is treated as a collision. */
export const SLUR_COLLISION_TOLERANCE_PX: number = 5;
