/* eslint-disable @typescript-eslint/typedef, max-len */
import { expect } from "vitest";
import { IXmlElement } from "../../../../src/Common/FileIO/Xml";
import { MusicSheet } from "../../../../src/MusicalScore/MusicSheet";
import { MusicSheetReader } from "../../../../src/MusicalScore/ScoreIO/MusicSheetReader";
import { VexFlowMusicSheetCalculator } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMusicSheetCalculator";
import { TestUtils } from "../../../Util/TestUtils";
import { VexFlowMeasure } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMeasure";
import { GraphicalNote } from "../../../../src/MusicalScore/Graphical/GraphicalNote";
import { GraphicalMusicSheet } from "../../../../src/MusicalScore/Graphical/GraphicalMusicSheet";
import { VexFlowGraphicalNote } from "../../../../src/MusicalScore/Graphical/VexFlow";
import * as VF from "vexflow";
import { unitInPixels, VexFlowMusicSheetDrawer } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowMusicSheetDrawer";
import { GraphicalSlur } from "../../../../src/MusicalScore/Graphical/GraphicalSlur";
import { SvgVexFlowBackend } from "../../../../src/MusicalScore/Graphical/VexFlow/SvgVexFlowBackend";
import { DrawingParameters } from "../../../../src/MusicalScore/Graphical/DrawingParameters";
import { EngravingRules } from "../../../../src/MusicalScore/Graphical/EngravingRules";
import JSZip from "jszip";
// fs/path imported lazily in writeAnnotatedSvg (browser mode lacks Node builtins)

// ── Data types ───────────────────────────────────────────────────────────────

interface BBoxRect { x: number; y: number; width: number; height: number; }

interface SlurInfo {
    id: string;
    vfId: string;
    isCrossed: boolean;
    startNoteStaff: number;
    endNoteStaff: number;
    startPt: { x: number; y: number };
    endPt: { x: number; y: number };
    startCp: { x: number; y: number } | null;
    endCp: { x: number; y: number } | null;
    cpY_osmd: number;
    mergedClearance: number;
    rightClearance: number;
    obstacleCount: number;
    svgStart: { x: number; y: number };
    svgEnd: { x: number; y: number };
    svgStartCp: { x: number; y: number } | null;
    svgEndCp: { x: number; y: number } | null;
    skyInfo: string;
    spanX: number;
    staffTopSvg: number;
    staffBottomSvg: number;
    leakPx: number; // positive = slur extends beyond staff boundary
    obstacleSvgPoints: Array<{ x: number; y: number; cat: string }>;
}

interface ScoreConfig {
    name: string;
    path: string;
    maxCpY: number;
    leakThreshold: number; // px above staff union boundary
}

const SCORES: ScoreConfig[] = [
    { name: "John Field", path: ".john-field-piano-concerto-7_m318-323.mxl", maxCpY: 6.0, leakThreshold: 50 },
    { name: "Dichterliebe", path: "Dichterliebe01.xml", maxCpY: 8.0, leakThreshold: 80 },
    { name: "Beethoven", path: "Beethoven_AnDieFerneGeliebte.xml", maxCpY: 6.0, leakThreshold: 40 },
    { name: "Liszt", path: ".Franz_Liszt_Transcendental_Etude_No.10_in_F_minor_Appassionata.mxl", maxCpY: 11.0, leakThreshold: 50 },
];

// ── Score loading ────────────────────────────────────────────────────────────

async function loadScore(path: string): Promise<{ calc: VexFlowMusicSheetCalculator, gms: GraphicalMusicSheet, reader: MusicSheetReader }> {
    let xmlString: string;
    if (path.endsWith(".mxl")) {
        const raw: string = TestUtils.getMXL(path);
        const zip: JSZip = await JSZip.loadAsync(raw, { base64: false, checkCRC32: false });
        const containerXml: string = await zip.file("META-INF/container.xml").async("text");
        const containerDoc: Document = new DOMParser().parseFromString(containerXml, "text/xml");
        const rootfileEl: Element = containerDoc.querySelector("rootfile");
        const musicXmlPath: string = rootfileEl?.getAttribute("full-path") ?? "";
        if (!musicXmlPath) { throw new Error("No rootfile in container.xml"); }
        xmlString = await zip.file(musicXmlPath).async("text");
    } else {
        xmlString = new XMLSerializer().serializeToString(TestUtils.getScore(path));
    }
    const score: Document = new DOMParser().parseFromString(xmlString, "text/xml");
    const partwise: Element = TestUtils.getPartWiseElement(score);
    const reader: MusicSheetReader = new MusicSheetReader();
    const calc: VexFlowMusicSheetCalculator = new VexFlowMusicSheetCalculator(reader.rules);
    const sheet: MusicSheet = reader.createMusicSheet(new IXmlElement(partwise), path);
    const gms: GraphicalMusicSheet = new GraphicalMusicSheet(sheet, calc);
    calc.calculate();
    return { calc, gms, reader };
}

// ── SVG rendering ────────────────────────────────────────────────────────────

function renderToSvg(gms: GraphicalMusicSheet, rules: EngravingRules): SVGSVGElement {
    const container: HTMLElement = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    document.body.appendChild(container);
    const dp: DrawingParameters = new DrawingParameters();
    dp.Rules = rules;
    const drawer: VexFlowMusicSheetDrawer = new VexFlowMusicSheetDrawer(dp);
    for (const page of gms.MusicPages) {
        if (page.PageNumber > rules.MaxPageToDrawNumber) { break; }
        const backend: SvgVexFlowBackend = new SvgVexFlowBackend(rules);
        backend.graphicalMusicPage = page;
        backend.initialize(container, 1.0);
        drawer.Backends.push(backend);
    }
    drawer.drawSheet(gms);
    const svg: SVGSVGElement = container.querySelector("svg")!;
    return svg;
}

// ── SVG BBox helpers ─────────────────────────────────────────────────────────

function bboxOf(el: Element): BBoxRect {
    if (typeof el.getBBox !== "function") { return { x: 0, y: 0, width: 0, height: 0 }; }
    try {
        const r: DOMRect = el.getBBox();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    } catch (_e) { return { x: 0, y: 0, width: 0, height: 0 }; }
}

/** Query notehead bboxes keyed by OSMD xmlId via data-note-id attribute. */
function queryNoteheadBBoxes(svg: SVGSVGElement): Map<string, BBoxRect> {
    const map: Map<string, BBoxRect> = new Map();
    for (const nh of svg.querySelectorAll("g.vf-notehead")) {
        const noteEl: Element | null = nh.closest("[data-note-id]");
        const xmlId: string = noteEl?.getAttribute("data-note-id") ?? "";
        if (xmlId) {
            const existing: BBoxRect | undefined = map.get(xmlId);
            const cur: BBoxRect = bboxOf(nh);
            if (!existing || cur.y < existing.y) { map.set(xmlId, cur); }
        }
    }
    return map;
}

/**
 * Query slur path bboxes keyed by OSMD xmlId.
 * Uses vfIdToXmlId map built from collectCrossStaffSlurs (vfId = VF5 auto ID,
 * xmlId = OSMD note id). The slur group id is vf-{autoId}-slur.
 */
function querySlurBBoxes(svg: SVGSVGElement, vfIdToXmlId: Map<string, string>): Map<string, BBoxRect> {
    const map: Map<string, BBoxRect> = new Map();
    for (const path of svg.querySelectorAll("g.vf-curve > path, g.vf-curve path")) {
        const fullD: string = path.getAttribute("d") ?? "";
        if (!fullD.includes("C")) { continue; }
        const parentG: Element | null = path.closest("g.vf-curve");
        const gid: string = parentG?.getAttribute("id") ?? "";
        // gid = "vf-auto{number}-slur"
        const m: RegExpMatchArray | null = gid.match(/^vf-(.+)-\w*slur$/);
        const vfId: string = m ? m[1] : gid;
        const xmlId: string = vfIdToXmlId.get(vfId) ?? "";
        if (xmlId) { map.set(xmlId, bboxOf(path)); }
    }
    return map;
}

// ── Coordinate helpers ───────────────────────────────────────────────────────

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
        }
    }
}

function toSvgCoords(osmdX: number, osmdY: number, sl: any): { x: number, y: number } {
    const abs: any = sl.PositionAndShape?.AbsolutePosition;
    if (!abs) { return { x: osmdX * unitInPixels, y: osmdY * unitInPixels }; }
    return {
        x: (osmdX + abs.x) * unitInPixels,
        y: (osmdY + abs.y) * unitInPixels,
    };
}

function dumpSkylineForSlur(sl: any, startX: number, endX: number): string {
    const sky: number[] = sl.SkyLine ?? [];
    if (!sky.length) { return "  (no skyline data)"; }
    const sbl: any = sl.SkyBottomLineCalculator;
    const samp: number = sbl?.SamplingUnit ?? 4;
    const lo: number = Math.max(0, Math.floor(startX * samp));
    const hi: number = Math.min(sky.length, Math.ceil(endX * samp));
    if (hi <= lo) { return "  (slur outside skyline range)"; }
    let minY: number = Infinity;
    let minIdx: number = -1;
    for (let i: number = lo; i < hi; i++) {
        if (sky[i] < minY) { minY = sky[i]; minIdx = i; }
    }
    const allVals: { idx: number, x: number, y: number }[] = [];
    for (let i: number = lo; i < hi; i++) {
        allVals.push({ idx: i, x: i / samp, y: sky[i] });
    }
    allVals.sort((a, b) => a.y - b.y);
    const worst: string = allVals.slice(0, 5).map(
        v => `x=${v.x.toFixed(2)} y=${v.y.toFixed(2)}`
    ).join(", ");
    return `  skylineRange=[${lo},${hi}) minY=${minY.toFixed(2)}@x=${(minIdx / samp).toFixed(2)} worst5=${worst}`;
}

function getMergedClearance(slur: any): number {
    return slur.mergedClearanceCpY ?? -Infinity;
}

function getRightClearance(slur: any): number {
    return slur.rightClearanceCpY ?? -Infinity;
}

// ── Slur collection ──────────────────────────────────────────────────────────

function collectCrossStaffSlurs(gms: GraphicalMusicSheet, rules: EngravingRules): SlurInfo[] {
    const result: SlurInfo[] = [];
    for (const page of gms.MusicPages) {
        for (const sys of page.MusicSystems) {
            for (const sl of sys.StaffLines) {
                for (const slur of sl.GraphicalSlurs) {
                    if (slur.slur.isCrossed()) {
                        slur.calculateCurveCrossStaff(rules);
                    } else {
                        if (!slur.bezierStartPt) { continue; }
                    }

                    const startNote: any = slur.slur.StartNote;
                    const endNote: any = slur.slur.EndNote;

                    const startGN: GraphicalNote = rules.GNote(slur.slur.StartNote);
                    const endGN: GraphicalNote = rules.GNote(slur.slur.EndNote);
                    const vfStart: VF.StaveNote = (startGN as VexFlowGraphicalNote)?.vfnote?.[0] as VF.StaveNote;
                    const vfEnd: VF.StaveNote = (endGN as VexFlowGraphicalNote)?.vfnote?.[0] as VF.StaveNote;
                    const sStave: VF.Stave | undefined = vfStart?.getStave?.();
                    const eStave: VF.Stave | undefined = vfEnd?.getStave?.();

                    const vfId: string = vfStart?.getAttribute?.("id") ?? "?";
                    // VF5 note id = xmlId (if set) ?? computedSvgId() (note-{m}-{s}-{v}-{i})
                    const noteId: string = startNote?.xmlId ?? endNote?.xmlId ?? vfId ?? "?";
                    const cpY_osmd: number = slur.bezierStartControlPt
                        ? Math.abs(slur.bezierStartControlPt.y - slur.bezierStartPt.y) : 0;
                    const mergedClear: number = getMergedClearance(slur);
                    const rightClear: number = getRightClearance(slur);
                    const obstacleCount: number = slur.debugSkyPoints?.length ?? 0;
                    const obstacleSvgPoints: Array<{ x: number; y: number; cat: string }> = [];
                    if (slur.debugSkyPoints && slur.debugSkyCategories) {
                        for (let oi: number = 0; oi < slur.debugSkyPoints.length && oi < slur.debugSkyCategories.length; oi++) {
                            const svgP: { x: number; y: number } = toSvgCoords(
                                slur.debugSkyPoints[oi].x, slur.debugSkyPoints[oi].y, sl);
                            obstacleSvgPoints.push({ x: svgP.x, y: svgP.y, cat: slur.debugSkyCategories[oi] });
                        }
                    }

                    const svgStart: { x: number, y: number } = toSvgCoords(
                        slur.bezierStartPt.x, slur.bezierStartPt.y, sl);
                    const svgEnd: { x: number, y: number } = toSvgCoords(
                        slur.bezierEndPt.x, slur.bezierEndPt.y, sl);
                    const svgStartCp: { x: number, y: number } | null = slur.bezierStartControlPt
                        ? toSvgCoords(slur.bezierStartControlPt.x, slur.bezierStartControlPt.y, sl) : null;
                    const svgEndCp: { x: number, y: number } | null = slur.bezierEndControlPt
                        ? toSvgCoords(slur.bezierEndControlPt.x, slur.bezierEndControlPt.y, sl) : null;

                    const skyInfo: string = dumpSkylineForSlur(sl,
                        slur.bezierStartPt.x, slur.bezierEndPt.x);

                    const spanX: number = slur.bezierEndPt.x - slur.bezierStartPt.x;

                    // Staff Y bounds in SVG pixels
                    const absPosY: number = sl.PositionAndShape?.AbsolutePosition?.y ?? 0;
                    const staffH: number = sl.PositionAndShape?.Size?.height ?? 40;
                    let stTopSvg: number = absPosY * unitInPixels;
                    let stBotSvg: number = (absPosY + staffH) * unitInPixels;
                    // Cross-staff: use union of all staves in same system
                    if (slur.slur.isCrossed()) {
                        const musicSys: any = sl.ParentMusicSystem;
                        if (musicSys?.StaffLines) {
                            for (const otherSl of musicSys.StaffLines) {
                                const oA: number = otherSl.PositionAndShape?.AbsolutePosition?.y ?? absPosY;
                                const oH2: number = otherSl.PositionAndShape?.Size?.height ?? staffH;
                                const oT: number = oA * unitInPixels;
                                const oB: number = (oA + oH2) * unitInPixels;
                                if (oT < stTopSvg) { stTopSvg = oT; }
                                if (oB > stBotSvg) { stBotSvg = oB; }
                            }
                        }
                    }

                    // Leak: how far bezier extends beyond staff boundary (SVG px)
                    let leakPx: number = 0;
                    if (svgStartCp && svgEndCp) {
                        const above: boolean = cpY_osmd > 0
                            && slur.bezierStartControlPt!.y < slur.bezierStartPt.y;
                        // Bezier Y at t=0.5 approximates curve's max extent
                        const midY: number = 0.125 * svgStart.y + 0.375 * svgStartCp.y
                            + 0.375 * svgEndCp.y + 0.125 * svgEnd.y;
                        if (above) {
                            // Above-placement: curve extends upward (smaller Y)
                            const curveTop: number = Math.min(svgStart.y, svgEnd.y, svgStartCp.y, svgEndCp.y, midY);
                            if (curveTop < stTopSvg) { leakPx = stTopSvg - curveTop; }
                        } else {
                            // Below-placement: curve extends downward (larger Y)
                            const curveBot: number = Math.max(svgStart.y, svgEnd.y, svgStartCp.y, svgEndCp.y);
                            if (curveBot > stBotSvg) { leakPx = curveBot - stBotSvg; }
                        }
                    }

                    result.push({
                        id: noteId,
                        vfId: vfId,
                        isCrossed: slur.slur.isCrossed(),
                        startNoteStaff: startNote?.ParentStaffEntry?.ParentStaff?.id,
                        endNoteStaff: endNote?.ParentStaffEntry?.ParentStaff?.id,
                        startPt: { x: slur.bezierStartPt.x, y: slur.bezierStartPt.y },
                        endPt: { x: slur.bezierEndPt.x, y: slur.bezierEndPt.y },
                        startCp: slur.bezierStartControlPt ? { x: slur.bezierStartControlPt.x, y: slur.bezierStartControlPt.y } : null,
                        endCp: slur.bezierEndControlPt ? { x: slur.bezierEndControlPt.x, y: slur.bezierEndControlPt.y } : null,
                        cpY_osmd,
                        mergedClearance: mergedClear,
                        rightClearance: rightClear,
                        obstacleCount,
                        obstacleSvgPoints,
                        svgStart,
                        svgEnd,
                        svgStartCp,
                        svgEndCp,
                        skyInfo,
                        spanX,
                        staffTopSvg: stTopSvg,
                        staffBottomSvg: stBotSvg,
                        leakPx,
                    });
                }
            }
        }
    }
    return result;
}

// ── SVG structure dump ───────────────────────────────────────────────────────

function dumpSvgStructure(svg: SVGSVGElement): void {
    const paths: Element[] = [...svg.querySelectorAll("path")];
    const beziers: Element[] = paths.filter(p => (p.getAttribute("d") ?? "").includes("C"));
    console.warn(`\n  ── SVG bezier paths (${beziers.length}/${paths.length} total) ──`);
    for (const p of beziers) {
        const d: string = p.getAttribute("d") ?? "";
        const coords: string = d.length > 100 ? d.substring(0, 100) + "..." : d;
        const pid: string = p.closest("g")?.getAttribute("id") ?? "(no-g)";
        console.warn(`    <path d="${coords}" in-g="${pid}"`);
    }
    const staves: Element[] = [...svg.querySelectorAll("g.vf-stave")];
    console.warn(`  Staff groups (g.vf-stave): ${staves.length}`);
    for (const st of staves.slice(0, 4)) {
        const notesInStave: number = st.querySelectorAll("g.vf-notehead").length;
        const beamsInStave: number = st.querySelectorAll("g.vf-beam").length;
        console.warn(`    ${st.getAttribute("id")}: ${notesInStave} noteheads, ${beamsInStave} beams`);
    }
    const vfNoteheads: Element[] = [...svg.querySelectorAll("g.vf-notehead")];
    console.warn(`  g.vf-notehead elements: ${vfNoteheads.length}`);
}

// ── Problem SVG annotation ───────────────────────────────────────────────────

function writeAnnotatedSvg(svg: SVGSVGElement, slurs: SlurInfo[], cfg: ScoreConfig): void {
    const isNode: boolean = typeof process !== "undefined" && typeof require !== "undefined";
    const envTag: string = isNode ? "_jsdom" : "_browser";
    const outName: string = `${cfg.name.replace(/\s+/g, "_")}${envTag}.svg`;

    const clone: SVGSVGElement = svg.cloneNode(true) as SVGSVGElement;
    const ns: string = "http://www.w3.org/2000/svg";

    // Fix viewBox: compute bounds from path/rect coordinate data
    let minX: number = Infinity, minY: number = Infinity;
    let maxX: number = -Infinity, maxY: number = -Infinity;
    for (const el of clone.querySelectorAll("path, rect")) {
        const d: string | null = el.getAttribute("d")
            || el.getAttribute("x") && `M${el.getAttribute("x")} ${el.getAttribute("y")}`
            || "";
        const nums: number[] = d.match(/[\d.]+/g)?.map(Number) ?? [];
        for (let i: number = 0; i + 1 < nums.length; i += 2) {
            const x: number = nums[i];
            const y: number = nums[i + 1];
            if (isFinite(x) && isFinite(y)) {
                if (x < minX) { minX = x; }
                if (y < minY) { minY = y; }
                if (x > maxX) { maxX = x; }
                if (y > maxY) { maxY = y; }
            }
        }
    }
    if (isFinite(minX) && isFinite(minY) && maxX > minX && maxY > minY) {
        const pad: number = 50;
        const w: number = maxX - minX + pad * 2;
        const h: number = maxY - minY + pad * 2;
        clone.setAttribute("viewBox", `${minX - pad} ${minY - pad} ${w} ${h}`);
    }

    let fontCss: string = "";
    if (isNode) {
        const p2: any = require("path");
        const f2: any = require("fs");
        const fd: string = p2.resolve(__dirname, "../../../../external/vexflow/node_modules/@vexflow-fonts");
        for (const [family, file] of [["Bravura","bravura/bravura.woff2"], ["Gonville","gonville/gonville.woff2"]]) {
            const fp: string = p2.join(fd, file);
            if (f2.existsSync(fp)) {
                const b64: string = f2.readFileSync(fp).toString("base64");
                fontCss += `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${b64})}`;
            }
        }
    }
    const styleEl: SVGStyleElement = document.createElementNS(ns, "style") as SVGStyleElement;
    styleEl.textContent = fontCss + `.problem-slur{fill:rgba(255,40,40,0.35)!important}
.problem-marked{stroke:#c00!important;stroke-width:4px!important}
.problem-rect{fill:none;stroke:#c00;stroke-width:1}
.problem-label{font:9px sans-serif;fill:#c00}
.problem-bg{fill:rgba(255,255,255,0.5);stroke:#c00;stroke-width:1;rx:2}`;
    clone.insertBefore(styleEl, clone.firstChild);

    for (const s of slurs) {
        const hw: number = s.cpY_osmd / Math.max(0.01, Math.abs(s.spanX));
        const isBalloon: boolean = !s.isCrossed && (s.cpY_osmd > cfg.maxCpY || hw > 0.85);
        const isLeak: boolean = s.leakPx > cfg.leakThreshold;
        let isCollision: boolean = false;
        if (!s.isCrossed && s.startCp && s.obstacleSvgPoints.length > 0) {
            const sx: number = s.svgStart.x, ex: number = s.svgEnd.x;
            const spanX: number = ex - sx;
            if (spanX > 1) {
                for (const op of s.obstacleSvgPoints) {
                    const t: number = (op.x - sx) / spanX;
                    if (t < 0.05 || t > 0.95) { continue; }
                    const t1: number = 1 - t;
                    const bY: number = t1*t1*t1 * s.svgStart.y
                        + 3*t1*t1*t * s.svgStartCp!.y
                        + 3*t1*t*t * s.svgEndCp!.y
                        + t*t*t * s.svgEnd.y;
                    if (bY >= op.y - 10) { isCollision = true; break; }
                }
            }
        }
        const isProblem: boolean = isBalloon || isLeak || isCollision;

        if (!isProblem || !s.startCp) { continue; }

        // Find the slur SVG group by ID
        const slurId: string = `vf-${s.id}-slur`;
        const slurGroup: Element | null = clone.querySelector(`[id="${slurId}"]`);
        if (!slurGroup) { continue; }

        slurGroup.classList.add("problem-slur", "problem-marked");

        const p2: Element | null = slurGroup.querySelector("path");
        if (p2) {
            p2.removeAttribute("stroke");
            p2.removeAttribute("fill");
            p2.setAttribute("fill", "rgba(255,40,40,0.35)");
            p2.setAttribute("stroke", "#c00");
            p2.setAttribute("stroke-width", "4");
        }

        // Bbox rect around the slur path
        const addRect = (): void => {
            const pe: Element | null = slurGroup.querySelector("path");
            if (!pe) { return; }
            const d: string = pe.getAttribute("d") ?? "";
            const nums: number[] = d.match(/[\d.]+/g)?.map(Number) ?? [];
            if (nums.length < 4) { return; }
            let mnX: number = Infinity, mnY: number = Infinity;
            let mxX: number = -Infinity, mxY: number = -Infinity;
            for (let i: number = 0; i + 1 < nums.length; i += 2) {
                if (nums[i] < mnX) { mnX = nums[i]; }
                if (nums[i] > mxX) { mxX = nums[i]; }
                if (nums[i+1] < mnY) { mnY = nums[i+1]; }
                if (nums[i+1] > mxY) { mxY = nums[i+1]; }
            }
            if (mxX <= mnX || mxY <= mnY) { return; }
            const rect: SVGRectElement = document.createElementNS(ns, "rect") as SVGRectElement;
            rect.setAttribute("class", `problem-rect`);
            rect.setAttribute("x", String(mnX - 3));
            rect.setAttribute("y", String(mnY - 3));
            rect.setAttribute("width", String(mxX - mnX + 6));
            rect.setAttribute("height", String(mxY - mnY + 6));
            slurGroup.parentNode?.insertBefore(rect, slurGroup);
        };
        addRect();

        // Labels at bottom-right, stacked
        const lbls: string[] = [];
        if (isBalloon) { lbls.push(`hw=${hw.toFixed(2)}`); }
        if (isLeak) { lbls.push(`leak=${s.leakPx.toFixed(0)}px`); }
        if (isCollision) { lbls.push("collision"); }
        if (!s.startCp) { continue; }
        let lx: number = s.svgStart.x;
        let ly: number = Math.max(s.svgStartCp.y, s.svgEndCp.y) + 18;
        const prevRect: Element | null = slurGroup.previousElementSibling;
        if (prevRect && prevRect.tagName === "rect" && prevRect.hasAttribute("x")) {
            lx = parseFloat(prevRect.getAttribute("x")!);
            ly = parseFloat(prevRect.getAttribute("y")!) + parseFloat(prevRect.getAttribute("height")!) + 2;
        }
        for (let li: number = 0; li < lbls.length; li++) {
            const txt: string = lbls[li];
            const yy: number = ly + li * 18;
            const bgR: SVGRectElement = document.createElementNS(ns, "rect") as SVGRectElement;
            bgR.setAttribute("class", "problem-bg");
            bgR.setAttribute("x", String(lx - 4));
            bgR.setAttribute("y", String(yy - 12));
            bgR.setAttribute("width", String(txt.length * 7 + 8));
            bgR.setAttribute("height", "16");
            slurGroup.parentNode?.insertBefore(bgR, slurGroup);
            const lb: SVGTextElement = document.createElementNS(ns, "text") as SVGTextElement;
            lb.setAttribute("class", "problem-label");
            lb.setAttribute("x", String(lx));
            lb.setAttribute("y", String(yy));
            lb.textContent = txt;
            slurGroup.parentNode?.insertBefore(lb, slurGroup);
        }

        // Draw obstacle points as tiny circles
        for (const op of s.obstacleSvgPoints) {
            const circ: SVGCircleElement = document.createElementNS(ns, "circle") as SVGCircleElement;
            const isSky: boolean = op.cat === "skyline";
            circ.setAttribute("r", isSky ? "2.5" : "3.5");
            circ.setAttribute("cx", String(op.x));
            circ.setAttribute("cy", String(op.y));
            circ.setAttribute("fill", isSky ? "rgba(0,180,0,0.6)" : "rgba(255,165,0,0.8)");
            circ.setAttribute("stroke", isSky ? "#060" : "#f80");
            circ.setAttribute("stroke-width", "1");
            slurGroup.parentNode?.insertBefore(circ, slurGroup);
        }
    }

    const svgStr: string = new XMLSerializer().serializeToString(clone);
    if (isNode) {
        const fs2: any = require("fs");
        const path2: any = require("path");
        const baseDir: string = process.env.DEBUG_SVG_DIR
            || path2.resolve(__dirname, "../../../../visual_regression/debug-svgs");
        if (!fs2.existsSync(baseDir)) { fs2.mkdirSync(baseDir, { recursive: true }); }
        const html: string = `<!DOCTYPE html><html><meta charset="utf-8"><body style="margin:0">${svgStr}</body></html>`;
        const stem: string = cfg.name.replace(/\s+/g, "_");
        fs2.writeFileSync(path2.join(baseDir, `${stem}${envTag}.html`), html);
        console.warn(`  ${stem}${envTag}.html`);
    } else {
        (async () => {
            const html: string = `<!DOCTYPE html><html><meta charset="utf-8"><body style="margin:0">${svgStr}</body></html>`;
            try {
                const { server: srv }: any = await import("@vitest/browser/context");
                if (srv?.commands?.writeFile) {
                    const outRel: string = `visual_regression/debug-svgs/${cfg.name.replace(/\s+/g, "_")}_${envTag}.html`;
                    await srv.commands.writeFile(outRel, html);
                    console.warn(`  ${outRel} (via vitest browser)`);
                    return;
                }
            } catch (_e) { /* fallback to data URL */ }
            console.warn(`  ${cfg.name.replace(/\s+/g, "_")}_${envTag}.html data URL logged`);
        })();
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Debug slur obstacles", () => {
    for (const cfg of SCORES) {
        describe(cfg.name, () => {
            let slurs: SlurInfo[];
            let svg: SVGSVGElement | null;
            let noteheadBBoxes: Map<string, BBoxRect>;
            let slurBBoxes: Map<string, BBoxRect>;

            beforeAll(async () => {
                const { calc, gms } = await loadScore(cfg.path);
                prepareMeasures(gms);
                slurs = collectCrossStaffSlurs(gms, calc.rules);

                // Build VF5 auto-ID → xmlId map for slur SVG lookup
                const vfIdToXmlId: Map<string, string> = new Map();
                for (const s of slurs) {
                    if (s.vfId && s.vfId !== "?" && s.id && s.id !== "?") {
                        vfIdToXmlId.set(s.vfId, s.id);
                    }
                }

                svg = renderToSvg(gms, calc.rules);
                noteheadBBoxes = queryNoteheadBBoxes(svg);
                slurBBoxes = querySlurBBoxes(svg, vfIdToXmlId);
            });

            afterAll(() => {
                if (svg && slurs.length > 0) {
                    try { writeAnnotatedSvg(svg, slurs, cfg); } catch (_e) { /* skip if fs unavailable */ }
                }
            });

            // ── Assertions ───────────────────────────────────────────────

            it("finds slurs", () => {
                expect(slurs.length).greaterThan(0,
                    `${cfg.name}: expected ≥1 slur, got ${slurs.length}`);
            });

            it("no excessive ballooning — cpY within limit", () => {
                const failures: string[] = [];
                for (const s of slurs) {
                    const hw: number = s.cpY_osmd / Math.max(0.01, Math.abs(s.spanX));
                    if (s.isCrossed) {
                        // Cross-staff slurs have inherent staff gap; use height-width ratio
                        if (hw > 3.0) {
                            failures.push(`${s.id} cpY=${s.cpY_osmd.toFixed(2)} spanX=${s.spanX.toFixed(2)} hw=${hw.toFixed(3)} obs=${s.obstacleCount} > maxHw=3.0`);
                        }
                    } else {
                        // Non-cross slurs: fail if cpY exceeds limit OR taller than wide
                        if (s.cpY_osmd > cfg.maxCpY || hw > 0.85) {
                            failures.push(`${s.id} cpY=${s.cpY_osmd.toFixed(2)} spanX=${s.spanX.toFixed(2)} hw=${hw.toFixed(3)} obs=${s.obstacleCount} maxCpY=${cfg.maxCpY}`);
                        }
                    }
                }
                expect(failures, `${failures.length} slurs exceed limits`)
                    .to.deep.equal([]);
            });

            it("no absurd spanX or staff height", () => {
                const failures: string[] = [];
                for (const s of slurs) {
                    const absSpan: number = Math.abs(s.spanX);
                    const staffH: number = s.staffBottomSvg - s.staffTopSvg;
                    if (isNaN(s.spanX) || isNaN(s.staffTopSvg) || isNaN(s.staffBottomSvg)) {
                        failures.push(`${s.id} NaN coordinates`);
                    }
                    if (absSpan < 0.1 && s.spanX !== 0) {
                        failures.push(`${s.id} spanX=${s.spanX.toFixed(2)} near-zero`);
                    }
                    if (staffH <= 0) {
                        failures.push(`${s.id} staffH=${staffH.toFixed(1)} <= 0`);
                    }
                    if (s.leakPx < 0) {
                        failures.push(`${s.id} negative leak=${s.leakPx.toFixed(1)}`);
                    }
                }
                expect(failures, `${failures.length} slurs with absurd data`)
                    .to.deep.equal([]);
            });

            it("no leaking into adjacent staff systems", () => {
                const failures: string[] = [];
                for (const s of slurs) {
                    if (s.leakPx <= cfg.leakThreshold) { continue; }
                    failures.push(`${s.id} leak=${s.leakPx.toFixed(1)}px > ${cfg.leakThreshold}px`);
                }
                expect(failures, `${failures.length} slurs leak into adjacent staff`)
                    .to.deep.equal([]);
            });

            // Clearance verified visually via obstacle dots on annotated SVG.
            // Relies on mergedClearanceCpY check above (obstacle clearance).

            it("above-placement non-cross slurs have obstacle clearance", () => {
                const above: SlurInfo[] = slurs.filter(s => !s.isCrossed);
                if (above.length === 0) { return; }
                const active: number = above.filter(s => s.mergedClearance > 0).length;
                // Injection adds start/end noteheads for non-cross above slurs
                expect(active, `${active}/${above.length} have mergedClearance>0`)
                    .greaterThan(Math.max(1, Math.floor(above.length * 0.2)));
            });

            // ── Debug dump ──────────────────────────────────────────────

            it("reports slurs", () => {
                console.warn(`\n=== ${cfg.name} (${cfg.path}) ===`);
                console.warn(`Found ${slurs.length} slurs`);
                console.warn(`SVG: ${noteheadBBoxes.size} noteheads, ${slurBBoxes.size} slurs mapped`);

                const ballooned: SlurInfo[] = slurs.filter(s => s.cpY_osmd > cfg.maxCpY);
                const normal: SlurInfo[] = slurs.filter(s => s.cpY_osmd <= cfg.maxCpY);
                console.warn(`Ballooned (>${cfg.maxCpY}): ${ballooned.length}  Normal: ${normal.length}`);

                for (const s of slurs) {
                    const flag: string = s.cpY_osmd > cfg.maxCpY ? " ⚠️BALLOONED" : "";
                    console.warn(`\n  Slur ${s.id}${flag}:`);
                    console.warn(`    vfId=${s.vfId} isCrossed=${s.isCrossed}`);
                    console.warn(`    OSMD:  start=(${s.startPt.x.toFixed(2)}, ${s.startPt.y.toFixed(2)})  end=(${s.endPt.x.toFixed(2)}, ${s.endPt.y.toFixed(2)}) spanX=${s.spanX.toFixed(2)}`);
                    if (s.startCp) {
                        console.warn(`    CPs:  cp1=(${s.startCp.x.toFixed(2)}, ${s.startCp.y.toFixed(2)}) cp2=(${s.endCp.x.toFixed(2)}, ${s.endCp.y.toFixed(2)}) cpY=${s.cpY_osmd.toFixed(2)} mL=${s.mergedClearance.toFixed(2)} rC=${s.rightClearance.toFixed(2)} obs=${s.obstacleCount} leak=${s.leakPx.toFixed(1)}px`);
                    }
                    console.warn(`    SVG:  M${s.svgStart.x.toFixed(1)} ${s.svgStart.y.toFixed(1)} C${s.svgStartCp?.x.toFixed(1) ?? "?"} ${s.svgStartCp?.y.toFixed(1) ?? "?"},${s.svgEndCp?.x.toFixed(1) ?? "?"} ${s.svgEndCp?.y.toFixed(1) ?? "?"},${s.svgEnd.x.toFixed(1)} ${s.svgEnd.y.toFixed(1)}`);
                    console.warn(`    ratio=cpY/span=${(s.cpY_osmd / Math.max(0.01, s.spanX)).toFixed(3)}`);

                    // SVG bbox cross-check
                    const slBBox: BBoxRect | undefined = slurBBoxes.get(s.id);
                    const nhBBox: BBoxRect | undefined = noteheadBBoxes.get(s.id);
                    if (slBBox && nhBBox && nhBBox.height > 0) {
                        console.warn(`    SVG bbox: slur_top=${slBBox.y.toFixed(1)} note_top=${nhBBox.y.toFixed(1)} clear=${(nhBBox.y - slBBox.y).toFixed(1)}px`);
                    }
                }

                // Show top worst ballooning
                const sorted: SlurInfo[] = [...slurs].sort((a, b) => b.cpY_osmd - a.cpY_osmd);
                console.warn(`\n  ── Top 5 worst by cpY ──`);
                for (let i: number = 0; i < Math.min(5, sorted.length); i++) {
                    const s: SlurInfo = sorted[i];
                    console.warn(`    #${i+1}: ${s.id} cpY=${s.cpY_osmd.toFixed(2)} spanX=${s.spanX.toFixed(2)} hw=${(s.cpY_osmd / Math.max(0.01, Math.abs(s.spanX))).toFixed(3)} obs=${s.obstacleCount} mL=${s.mergedClearance.toFixed(2)} rC=${s.rightClearance.toFixed(2)} leak=${s.leakPx.toFixed(1)}px`);
                }

                if (svg) { dumpSvgStructure(svg); }
            });

            // Dichterliebe-specific: cross-staff slurs with positive bow
            if (cfg.name === "Dichterliebe") {
                it("cross-staff slurs have positive bow", () => {
                    const cs: SlurInfo[] = slurs.filter(s => s.isCrossed || s.spanX > 15);
                    const failures: string[] = [];
                    for (const s of cs) {
                        if (s.cpY_osmd < 0.5) {
                            failures.push(`${s.id} cpY=${s.cpY_osmd.toFixed(2)}`);
                        }
                    }
                    expect(failures, `${failures.length} cross slurs with low bow`)
                        .to.deep.equal([]);
                });
            }
        });
    }
});
