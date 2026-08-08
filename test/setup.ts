import fs from "fs";
import path from "path";
import { registerFont } from "canvas";

// Replicate karma-xml2js-preprocessor + karma-base64-to-js-preprocessor:
// Populate globalThis.__xml__ and globalThis.__raw__ so TestUtils works unchanged.

const DATA_DIR: string = path.resolve(__dirname, "data");

function getFiles(exts: string[]): string[] {
  const all: string[] = fs.readdirSync(DATA_DIR);
  return all.filter((f: string) => exts.some((ext: string) => f.endsWith(ext)));
}

// XML / MusicXML files → Document via DOMParser
const xmlFiles: string[] = getFiles([".xml", ".musicxml"]);
const xmlMap: Record<string, Document> = {};
for (const file of xmlFiles) {
  const fullPath: string = path.join(DATA_DIR, file);
  const content: string = fs.readFileSync(fullPath, "utf-8");
  xmlMap[`test/data/${file}`] = new DOMParser().parseFromString(content, "text/xml");
}

// MXL files → raw binary string (starts with PK, JSZip.loadAsync expects raw bytes)
const mxlFiles: string[] = getFiles([".mxl"]);
const rawMap: Record<string, string> = {};
for (const file of mxlFiles) {
  const fullPath: string = path.join(DATA_DIR, file);
  // latin1 maps each byte to a single char (0-255), preserving binary content as string
  rawMap[`test/data/${file}`] = fs.readFileSync(fullPath, "latin1");
}

(globalThis as any).__xml__ = xmlMap;
(globalThis as any).__raw__ = rawMap;

// Register SMuFL fonts so VF5's measureText() returns real glyph widths.
// node-canvas (canvas npm pkg) is required — must exist in node_modules.
// generateImages_browserless.cjs uses the same approach.
const VEXFLOW_FONTS_DIR: string = path.resolve(__dirname, "../external/vexflow/node_modules/@vexflow-fonts");
const FONT_OTFS: [string, string][] = [
  ["bravura/bravura.otf", "Bravura"],
  ["gonville/gonville.otf", "Gonville"],
  ["petaluma/petaluma.otf", "Petaluma"],
  ["petalumascript/petalumascript.otf", "Petaluma Script"],
  ["academico/academico.otf", "Academico"],
  ["academico/academico-bold.otf", "Academico"],
];
for (const [relPath, family] of FONT_OTFS) {
  const fullPath: string = path.join(VEXFLOW_FONTS_DIR, relPath);
  if (fs.existsSync(fullPath)) {
    registerFont(fullPath, { family });
  }
}
// Preload woff2 font data for SVG annotation in debug tests.
// Stored in globalThis so debug tests can inject @font-face regardless
// of JSDOM/browser mode (without requiring fs at annotation time).
const FONT_WOFF2: [string, string][] = [
  ["Bravura", "bravura/bravura.woff2"],
  ["Gonville", "gonville/gonville.woff2"],
];
const fontData: Record<string, string> = {};
for (const [family, relPath] of FONT_WOFF2) {
  const fullPath: string = path.join(VEXFLOW_FONTS_DIR, relPath);
  if (fs.existsSync(fullPath)) {
    fontData[family] = fs.readFileSync(fullPath).toString("base64");
  }
}
(globalThis as any).__fontData__ = fontData;

// No more fake getContext mock — VF5 uses document.createElement('canvas')
// which jsdom 29+ backs with node-canvas automatically when the `canvas`
// package is installed. If this fails (missing Cairo libs etc.), the first
// test calling measureText throws — no silent fallback.
