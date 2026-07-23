/** Render skill-graph MusicXML dump to PNGs via OSMD (headless).
 *
 * Usage:
 *   node test/Util/renderReadingNotations.cjs <dumpDir> [pageWidth] [pageHeight]
 *
 * Walks dumpDir recursively, finds exercise.musicxml files, renders each
 * to exercise.png alongside.
 */
"use strict";
const FS = require("fs");
const path = require("path");
const { registerFont } = require("canvas");
const OSMD = require("../../build/opensheetmusicdisplay.min.js");

const VEXFLOW_FONTS_DIR = (function findFontsDir() {
    const candidates = [
        path.resolve(__dirname, "../../external/vexflow/node_modules/@vexflow-fonts"),
        path.resolve(__dirname, "../../../../osmd-vf5/external/vexflow/node_modules/@vexflow-fonts"),
    ];
    for (const c of candidates) {
        if (FS.existsSync(path.join(c, "bravura/bravura.otf"))) return c;
    }
    console.error("Cannot find @vexflow-fonts directory");
    process.exit(1);
})();

// Inline font data URIs for SVG output (not needed for PNG, but OSMD may use them).
const FONT_DATA_URIS = {};
(function preload() {
    const fonts = {
        Bravura: "bravura/bravura.woff2",
        Gonville: "gonville/gonville.woff2",
        Petaluma: "petaluma/petaluma.woff2",
        "Petaluma Script": "petalumascript/petalumascript.woff2",
        Academico: "academico/academico.woff2",
    };
    for (const [name, rel] of Object.entries(fonts)) {
        const fp = path.join(VEXFLOW_FONTS_DIR, rel);
        if (FS.existsSync(fp)) {
            FONT_DATA_URIS[name] = "data:font/woff2;base64," + FS.readFileSync(fp).toString("base64");
        }
    }
})();

function debug(msg) {
    console.log("[renderReadingNotations] " + msg);
}

async function init() {
    const dumpDir = process.argv[2];
    const pageWidth = parseInt(process.argv[3], 10) || 1440;
    const pageHeight = parseInt(process.argv[4], 10) || 32767;

    if (!dumpDir) {
        console.error("usage: node test/Util/renderReadingNotations.cjs <dumpDir> [pageWidth] [pageHeight]");
        process.exit(1);
    }
    if (!FS.existsSync(dumpDir)) {
        console.error("dumpDir not found: " + dumpDir);
        process.exit(1);
    }

    // Register fonts
    for (const [name, file] of Object.entries({
        Bravura: "bravura/bravura.otf",
        Gonville: "gonville/gonville.otf",
        Petaluma: "petaluma/petaluma.otf",
        "Petaluma Script": "petalumascript/petalumascript.otf",
        Academico: "academico/academico.otf",
    })) {
        const fp = path.join(VEXFLOW_FONTS_DIR, file);
        if (FS.existsSync(fp)) registerFont(fp, { family: name });
    }
    registerFont(path.join(VEXFLOW_FONTS_DIR, "academico/academico-bold.otf"), { family: "Academico", weight: "bold" });

    // JSDOM setup
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!DOCTYPE html></html>");
    global.window = dom.window;
    global.document = window.document;
    global.HTMLElement = window.HTMLElement;
    global.XMLHttpRequest = window.XMLHttpRequest;
    global.DOMParser = window.DOMParser;
    global.Node = window.Node;
    global.Canvas = window.Canvas;

    try {
        const { default: headless_gl } = await import("gl");
        const oldCE = document.createElement.bind(document);
        document.createElement = function (tagName, options) {
            const el = oldCE(tagName, options);
            if (tagName.toLowerCase() === "canvas") {
                const oldGC = el.getContext.bind(el);
                el.getContext = function (type, attrs) {
                    if (type === "webgl" || type === "experimental-webgl") {
                        const gl = headless_gl(el.width, el.height, attrs);
                        gl.canvas = el;
                        return gl;
                    }
                    return oldGC(type, attrs);
                };
            }
            return el;
        };
    } catch (e) { /* headless-gl not available, 2D canvas only */ void e; }

    const div = document.createElement("div");
    div.id = "osmdDiv";
    document.body.appendChild(div);
    div.width = pageWidth;
    div.height = pageHeight;

    Object.defineProperties(window.HTMLElement.prototype, {
        offsetLeft: { get: function () { return parseFloat(window.getComputedStyle(this).marginLeft) || 0; } },
        offsetTop: { get: function () { return parseFloat(window.getComputedStyle(this).marginTop) || 0; } },
        offsetHeight: { get: function () { return pageHeight; } },
        offsetWidth: { get: function () { return pageWidth; } },
    });

    // Collect exercise.musicxml files
    const files = [];
    function walk(dir) {
        for (const entry of FS.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); }
            else if (entry.name === "exercise.musicxml") { files.push(full); }
        }
    }
    walk(dumpDir);
    debug(`Found ${files.length} exercise.musicxml files`);

    const osmd = new OSMD.OpenSheetMusicDisplay(div, {
        autoResize: false,
        backend: "canvas",
        pageBackgroundColor: "#FFFFFF",
        pageFormat: "Endless",
    });
    osmd.setLogLevel("error");

    let done = 0;
    let failed = 0;
    for (const mxmlPath of files) {
        const pngPath = path.join(path.dirname(mxmlPath), "exercise.png");
        // Skip if PNG is newer than source
        if (FS.existsSync(pngPath) && FS.statSync(pngPath).mtimeMs >= FS.statSync(mxmlPath).mtimeMs) {
            done++;
            continue;
        }
        try {
            const xml = FS.readFileSync(mxmlPath, "utf-8");
            await osmd.load(xml, mxmlPath);
            osmd.render();
            const canvas = document.getElementById("osmdCanvasVexFlowBackendCanvas1");
            if (!canvas || !canvas.toDataURL) {
                throw new Error("No canvas output");
            }
            const dataUrl = canvas.toDataURL();
            const imageData = dataUrl.split(";base64,").pop();
            FS.writeFileSync(pngPath, Buffer.from(imageData, "base64"));
            done++;
        } catch (e) {
            failed++;
            debug(`FAIL ${mxmlPath}: ${e.message}`);
        }
        if (done % 100 === 0 || (done + failed) % 100 === 0) {
            debug(`Progress: ${done} done, ${failed} failed, ${files.length - done - failed} remaining`);
        }
    }
    debug(`Complete: ${done} rendered, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
}

init().catch(e => { console.error(e); process.exit(1); });
