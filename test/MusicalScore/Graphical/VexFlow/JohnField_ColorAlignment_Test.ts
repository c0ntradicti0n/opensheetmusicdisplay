/* ====================================================================================================
 * !!! DO NOT EDIT THIS TEST UNTIL USER DELETES THIS COMMENT BLOCK !!!
 * This test captures the CURRENT (broken) alignment state of colored note pairs in the MXL file.
 * 8 of 9 color pairs are misaligned — the test MUST fail until we have a proper FIX
 * Once the implementation produces 0 misaligned pairs, USER deletes this comment block.
 * Until then, treat this test as the ground truth for what alignment SHOULD look like.
 * ==================================================================================================== */
/* eslint-disable @typescript-eslint/typedef */
import { expect } from "vitest";
import { OpenSheetMusicDisplay } from "../../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { TestUtils } from "../../../Util/TestUtils";
import { VexFlowVoiceEntry } from "../../../../src/MusicalScore/Graphical/VexFlow/VexFlowVoiceEntry";
import JSZip from "jszip";

interface ColorNote {
  color: string;
  measure: number;
  staff: number;       // MusicXML <staff> (1 or 2)
  seqInStaff: number;  // note index within (measure, staff)
}

describe("John Field colored note alignment", () => {
  it("colored note pairs at same beat share identical x position", async () => {
    // 1. Parse MXL for colored notes
    const raw: string = TestUtils.getMXL(".john-field-piano-concerto-7_m533-537.mxl");
    const zip: JSZip = await JSZip.loadAsync(raw, { base64: false, checkCRC32: false });
    const containerXml: string = await zip.file("META-INF/container.xml").async("text");
    const containerDoc: Document = new DOMParser().parseFromString(containerXml, "text/xml");
    const rootfileEl: Element | null = containerDoc.querySelector("rootfile");
    const musicXmlPath: string = rootfileEl?.getAttribute("full-path") ?? "";
    const mxlXml: string = await zip.file(musicXmlPath).async("text");
    const mxlDoc: Document = new DOMParser().parseFromString(mxlXml, "text/xml");

    // Extract colored notes with per-staff sequence
    const colorNotes: ColorNote[] = [];
    const parts: NodeListOf<Element> = mxlDoc.querySelectorAll("part");
    for (const part of parts) {
      const measures: NodeListOf<Element> = part.querySelectorAll("measure");
      for (const meas of measures) {
        const mn: number = parseInt(meas.getAttribute("number") ?? "0", 10);
        const notes: NodeListOf<Element> = meas.querySelectorAll("note");
        // Track sequence counter per staff
        const staffCounters: Map<number, number> = new Map();
        for (const note of notes) {
          const staffEl: Element | null = note.querySelector("staff");
          const staff: number = staffEl ? parseInt(staffEl.textContent ?? "1", 10) : 1;
          staffCounters.set(staff, (staffCounters.get(staff) ?? 0) + 1);
          const nh: Element | null = note.querySelector("notehead");
          const color: string | null = nh?.getAttribute("color");
          if (color) {
            colorNotes.push({ color, measure: mn, staff, seqInStaff: staffCounters.get(staff)! });
          }
        }
      }
    }
    console.log(`MXL: ${colorNotes.length} colored notes`);

    // 2. Render the MXL via OSMD and collect note positions per (measure, VF_staff)
    const container: HTMLElement = TestUtils.getDivElement(document);
    container.style.width = "1200px";
    container.style.height = "1600px";
    const osmd: OpenSheetMusicDisplay = new OpenSheetMusicDisplay(
      container, { autoResize: false, backend: "svg", drawTitle: false }
    );
    const blob: Blob = new Blob([mxlXml], { type: "text/xml" });
    await osmd.load(blob, ".john-field-piano-concerto-7_m533-537.mxl");
    osmd.render();

    const gms: any = (osmd as any).graphic;
    // MeasureList columns: each vml = one column, measures[i] for staff i
    // Collect rendered positions per (column_idx, staff)
    const renderedCols: { mxlMeasure: number, staffNotes: Map<number, number[]> }[] = [];

    for (const vml of gms.MeasureList) {
      if (!vml) {continue;}
      const visible: any[] = vml.filter((m: any) => m?.isVisible());
      if (visible.length < 2) {continue;} // skip if only one staff visible

      // All measures in column share the same column index
      // The first visible measure's number is the OSMD measure number
      const col: { mxlMeasure: number, staffNotes: Map<number, number[]> } = {
        mxlMeasure: visible[0].MeasureNumber, // OSMD measure number (1..5)
        staffNotes: new Map(),
      };
      for (const measure of visible) {
        const staffVF: number = measure.ParentStaff?.Id ?? -1;
        const xs: number[] = [];
        for (const se of measure.staffEntries) {
          if (!se) {continue;}
          for (const gve of se.graphicalVoiceEntries) {
            const vfve: VexFlowVoiceEntry = gve as VexFlowVoiceEntry;
            if (!vfve.vfStaveNote) {continue;}
            const sn: any = vfve.vfStaveNote;
            xs.push(Math.round((sn.getAbsoluteX?.() ?? -1) * 100) / 100);
          }
        }
        col.staffNotes.set(staffVF, xs);
      }
      renderedCols.push(col);
    }
    // MXL measures 533-537 map to OSMD columns 0..4
    const firstMXLMeasure: number = 533;
    console.log(`Rendered ${renderedCols.length} columns`);
    for (let i: number = 0; i < renderedCols.length; i++) {
      const rc = renderedCols[i];
      const mxlMeas: number = firstMXLMeasure + i;
      const staffInfo: string = [...rc.staffNotes.entries()]
        .map(([s, xs]) => `VFstaff${s}=${xs.length} notes [${xs.slice(0, 3).join(",")}...]`)
        .join(", ");
      console.log(`  col${i} OSMD m${rc.mxlMeasure} → MXL m${mxlMeas}: ${staffInfo}`);
    }

    // 2b. Cross-check: VF model vs SVG <text> x attributes (browser rendering)
    const svg: SVGElement | null = container.querySelector("svg");
    if (svg) {
      const staffGroups: NodeListOf<SVGGElement> = svg.querySelectorAll("g.staffline");
      console.log(`SVG has ${staffGroups.length} staffline groups`);
      for (let sgi: number = 0; sgi < staffGroups.length; sgi++) {
        const nhCount: number = staffGroups[sgi].querySelectorAll("g.vf-notehead").length;
        console.log(`  staffline ${sgi}: id=${staffGroups[sgi].getAttribute("id")} noteheads=${nhCount}`);
      }
      // Collect ALL SVG notehead x values for staff1 (treble = staffGroups[0] in system1)
      // Note: the first 2 staffGroups are system1, next 2 are system2
      // staffGroups[0] = treble system1, staffGroups[2] = treble system2
      const svgXs: Set<number> = new Set();
      // Collect from all treble groups (even indices)
      for (let sgi: number = 0; sgi < staffGroups.length; sgi += 2) {
        for (const nh of staffGroups[sgi]?.querySelectorAll("g.vf-notehead") ?? []) {
          const t: SVGTextElement | null = nh.querySelector("text");
          if (!t) {continue;}
          const x: number = Math.round(parseFloat(t.getAttribute("x") ?? "NaN") * 100) / 100;
          if (!isNaN(x)) {svgXs.add(x);}
        }
      }
      // For each VF model note in col1 staff1, check if SVG has a notehead at same x
      const col1VfX: number[] = renderedCols[1]?.staffNotes.get(1) ?? [];
      const svgSorted: number[] = [...svgXs].sort((a, b) => a - b);
      console.log(`  SVG staff1 xs (first 10): ${svgSorted.slice(0, 10).join(", ")}`);
      console.log(`  VF col1 xs (first 10): ${col1VfX.slice(0, 10).join(", ")}`);
      let found: number = 0;
      let missing: number = 0;
      for (const vfX of col1VfX) {
        let matched: boolean = false;
        for (const sX of svgXs) {
          if (Math.abs(sX - vfX) <= 1) { matched = true; break; }
        }
        if (matched) {found++;}
        else {missing++;}
      }
      console.log(`SVG x vs VF getAbsoluteX cross-check (col1 staff1, ${col1VfX.length} VF notes): ${found} match, ${missing} missing`);
      if (missing === 0) {console.log("  ✓ VF positions verified in SVG DOM — test reflects browser rendering");}
    }

    // 3. Match colored notes to rendered positions
    // VF staff Ids in this score are 1 (treble) and 2 (bass) — identity mapping
    const mxlStaffToVF: Map<number, number> = new Map([[1, 1], [2, 2]]);

    const colorGroups: Map<string, { color: string, xs: number[], measures: number[], staffs: number[] }> = new Map();

    for (const cn of colorNotes) {
      const vfStaff: number | undefined = mxlStaffToVF.get(cn.staff);
      if (vfStaff === undefined) {
        console.log(`  WARN: no VF staff mapping for MXL staff ${cn.staff}`);
        continue;
      }
      // MXL measure 534 → OSMD renderedCols index (534 - 533) = 1
      const rmIdx: number = cn.measure - firstMXLMeasure;
      if (rmIdx < 0 || rmIdx >= renderedCols.length) {
        console.log(`  WARN: measure ${cn.measure} out of range (idx=${rmIdx})`);
        continue;
      }
      const col: typeof renderedCols[0] = renderedCols[rmIdx];
      const availableStaffs: string = [...col.staffNotes.keys()].join(",");
      const staffNotes: number[] | undefined = col.staffNotes.get(vfStaff);
      if (!staffNotes) {
        console.log(`  WARN: no rendered notes for MXL m${cn.measure} staff=${cn.staff} → VFstaff=${vfStaff} (available: ${availableStaffs})`);
        continue;
      }
      const idx: number = cn.seqInStaff - 1; // 0-based
      if (idx >= staffNotes.length) {
        console.log(`  WARN: seq ${cn.seqInStaff} out of range for m${cn.measure} staff${vfStaff} (${staffNotes.length} notes)`);
        continue;
      }
      const x: number = staffNotes[idx];
      if (!colorGroups.has(cn.color)) {
        colorGroups.set(cn.color, { color: cn.color, xs: [], measures: [], staffs: [] });
      }
      const g = colorGroups.get(cn.color)!;
      g.xs.push(x);
      g.measures.push(cn.measure);
      g.staffs.push(cn.staff);
    }

    // 4. For each color with 2+ notes, check all share same x
    let misalignedCount: number = 0;
    let checkedCount: number = 0;
    const issues: string[] = [];

    for (const [color, g] of colorGroups) {
      if (g.xs.length < 2) {
        console.log(`  SKIP (single): ${color} m=${g.measures} staffs=${g.staffs}`);
        continue;
      }
      checkedCount++;
      const refX: number = g.xs[0];
      const mismatches: string[] = [];
      for (let i: number = 0; i < g.xs.length; i++) {
        if (Math.abs(g.xs[i] - refX) > 2) {
          mismatches.push(`staff${g.staffs[i]} x=${g.xs[i]}`);
        }
      }
      const info: string = g.staffs.map((s, i) => `s${s}=${g.xs[i]}`).join(", ");
      console.log(`  ${color} m=${g.measures[0]}: ${info} ${mismatches.length === 0 ? "✓" : "✗ MISALIGN"}`);
      if (mismatches.length > 0) {
        misalignedCount++;
        issues.push(`${color} m${g.measures[0]}: ${mismatches.join("; ")} (ref=${refX})`);
      }
    }

    console.log(`\nChecked ${checkedCount} color pairs, ${misalignedCount} misaligned`);
    for (const issue of issues) {console.log(`  FAIL: ${issue}`);}

    expect(checkedCount).to.be.at.least(8, `Need >=8 color pairs to check, got ${checkedCount}`);
    expect(misalignedCount, `Misaligned color pairs:\n${issues.join("\n")}`).to.equal(0);
  });
});
