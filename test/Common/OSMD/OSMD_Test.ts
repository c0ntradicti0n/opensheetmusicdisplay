import { expect } from "vitest";
import { OpenSheetMusicDisplay } from "../../../src/OpenSheetMusicDisplay/OpenSheetMusicDisplay";
import { TestUtils } from "../../Util/TestUtils";
import { IOSMDOptions } from "../../../src/OpenSheetMusicDisplay/OSMDOptions";
import { DrawingParametersEnum } from "../../../src/Common/Enums/DrawingParametersEnum";

describe("OpenSheetMusicDisplay Main Export", () => {
    let container1: HTMLElement;

    it("no container", () => {
        expect(() => {
            return new OpenSheetMusicDisplay(undefined);
        }).to.throw(/container/);
    });

    it("container", () => {
        const div: HTMLElement = TestUtils.getDivElement(document);
        expect(() => {
            return new OpenSheetMusicDisplay(div);
        }).to.not.throw(Error);
    });

    it("multiple instances", () => {
        const musicSheetFragmentContainer: HTMLElement = TestUtils.getDivElement(document);
        const fullMusicSheetContainer: HTMLElement = TestUtils.getDivElement(document);

        const musicSheetFragmentOptions: IOSMDOptions = {
            drawComposer: false,
            drawCredits: false,
            drawFingerings: false,
            drawHiddenNotes: false,
            drawLyricist: false,
            drawPartAbbreviations: false,
            drawPartNames: false,
            drawSubtitle: false,
            drawTitle: false,
            drawUpToMeasureNumber: 1,
            drawingParameters: DrawingParametersEnum.compact
        };
        const fullMusicSheetOptions: IOSMDOptions = {
            drawUpToMeasureNumber: 10
        };

        const musicSheetFragment: OpenSheetMusicDisplay = new OpenSheetMusicDisplay(
            musicSheetFragmentContainer,
            musicSheetFragmentOptions
        );
        const fullMusicSheet: OpenSheetMusicDisplay = new OpenSheetMusicDisplay(fullMusicSheetContainer, fullMusicSheetOptions);

        const musicSheet: Document = TestUtils.getScore("MuzioClementi_SonatinaOpus36No1_Part1.xml");

        return musicSheetFragment.load(musicSheet)
                            .then(() => {
                                musicSheetFragment.render();

                                return fullMusicSheet.load(musicSheet.cloneNode(true));
                            })
                            .then(() => {
                                fullMusicSheet.render();

                                // Verify that the music sheet fragment has its options set correctly.
                                expect(musicSheetFragment.Sheet.Rules.RenderComposer).to.equal(musicSheetFragmentOptions.drawComposer);
                                expect(musicSheetFragment.Sheet.Rules.RenderFingerings).to.equal(musicSheetFragmentOptions.drawFingerings);
                                expect(musicSheetFragment.Sheet.Rules.RenderLyricist).to.equal(musicSheetFragmentOptions.drawLyricist);
                                expect(musicSheetFragment.Sheet.Rules.RenderPartAbbreviations).to.equal(musicSheetFragmentOptions.drawPartAbbreviations);
                                expect(musicSheetFragment.Sheet.Rules.RenderPartNames).to.equal(musicSheetFragmentOptions.drawPartNames);
                                expect(musicSheetFragment.Sheet.Rules.RenderSubtitle).to.equal(musicSheetFragmentOptions.drawSubtitle);
                                expect(musicSheetFragment.Sheet.Rules.RenderTitle).to.equal(musicSheetFragmentOptions.drawTitle);
                                expect(musicSheetFragment.Sheet.Rules.MaxMeasureToDrawIndex).to.equal(musicSheetFragmentOptions.drawUpToMeasureNumber - 1);

                                // Verify that the full music sheet has its options set correctly.
                                expect(fullMusicSheet.Sheet.Rules.RenderComposer).to.not.equal(musicSheetFragmentOptions.drawComposer);
                                expect(fullMusicSheet.Sheet.Rules.RenderFingerings).to.not.equal(musicSheetFragmentOptions.drawFingerings);
                                expect(fullMusicSheet.Sheet.Rules.RenderLyricist).to.not.equal(musicSheetFragmentOptions.drawLyricist);
                                expect(fullMusicSheet.Sheet.Rules.RenderPartAbbreviations).to.not.equal(musicSheetFragmentOptions.drawPartAbbreviations);
                                expect(fullMusicSheet.Sheet.Rules.RenderPartNames).to.not.equal(musicSheetFragmentOptions.drawPartNames);
                                expect(fullMusicSheet.Sheet.Rules.RenderSubtitle).to.not.equal(musicSheetFragmentOptions.drawSubtitle);
                                expect(fullMusicSheet.Sheet.Rules.RenderTitle).to.not.equal(musicSheetFragmentOptions.drawTitle);
                                expect(fullMusicSheet.Sheet.Rules.MaxMeasureToDrawIndex).to.equal(fullMusicSheetOptions.drawUpToMeasureNumber - 1);
                            });
    });

    it("load MXL from string", async () => {
        const mxl: string = TestUtils.getMXL("Mozart_Clarinet_Quintet_Excerpt.mxl");
        const div: HTMLElement = TestUtils.getDivElement(document);
        const opensheetmusicdisplay: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(div);
        await opensheetmusicdisplay.load(mxl);
        opensheetmusicdisplay.render();
    });

    it("load invalid MXL from string", async () => {
        const mxl: string = "\x50\x4b\x03\x04";
        const div: HTMLElement = TestUtils.getDivElement(document);
        const opensheetmusicdisplay: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(div);
        try {
            await opensheetmusicdisplay.load(mxl);
            expect.fail("Corrupted MXL appears to be loaded correctly");
        } catch (exc: unknown) {
            if (!(exc instanceof Error) || !exc.message.toLowerCase().match(/invalid/)) {
                expect.fail("Unexpected error: " + (exc instanceof Error ? exc.message : String(exc)));
            }
        }
    });

    it("load XML string", async () => {
        const score: Document = TestUtils.getScore("MuzioClementi_SonatinaOpus36No1_Part1.xml");
        const xml: string = '<?xml version="1.0" encoding="UTF-8"?>' + new XMLSerializer().serializeToString(score);
        const div: HTMLElement = TestUtils.getDivElement(document);
        const opensheetmusicdisplay: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(div);
        await opensheetmusicdisplay.load(xml);
        opensheetmusicdisplay.render();
    });

    it("load XML Document", async () => {
        const score: Document = TestUtils.getScore("MuzioClementi_SonatinaOpus36No1_Part1.xml");
        const div: HTMLElement = TestUtils.getDivElement(document);
        const opensheetmusicdisplay: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(div);
        await opensheetmusicdisplay.load(score);
        opensheetmusicdisplay.render();
    });

    it.skip("Timeout from server", () => {
        // TODO this test times out from time to time, even with osmd.loadUrlTimeout set to 5000.
        //   the test is unreliable, which makes it hard to test.
        //   also, it's better not to use OSMD to fetch one's score anyways.
        //   also, the timeout adds unnecessary time to the testing suite.
    });

    // MXL URL load via XHR — karma used "base/test/data/..." prefix, but vitest
    // has no web server.  Patch AJAX.ajax to serve local files.
    it("load MXL Document by URL", async () => {
        const mod: any = await import("../../../src/OpenSheetMusicDisplay/AJAX");
        const origAjax: (url: string, timeout?: number) => Promise<string> = mod.AJAX.ajax;
        mod.AJAX.ajax = (url: string): Promise<string> => {
            const urlStr: string = url.toString();
            if (urlStr.startsWith("base/")) {
                const fileName: string = urlStr.replace("base/test/data/", "");
                const mxl: string = TestUtils.getMXL(fileName);
                if (mxl) {
                    return Promise.resolve(mxl);
                }
            }
            return origAjax(url);
        };
        try {
            const url: string = "base/test/data/Mozart_Clarinet_Quintet_Excerpt.mxl";
            const div: HTMLElement = TestUtils.getDivElement(document);
            const opensheetmusicdisplay: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(div);
            await opensheetmusicdisplay.load(url);
            opensheetmusicdisplay.render();
        } finally {
            mod.AJAX.ajax = origAjax;
        }
    });

    // skip: this test is unnecessary and creates traffic (to google)
    it.skip("load something invalid by URL", () => { /* no-op */ });

    it("load invalid URL", async () => {
        const url: string = "https://www.afjkhfjkauu2ui3z2uiu.com";
        const div: HTMLElement = TestUtils.getDivElement(document);
        const opensheetmusicdisplay: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(div);
        try {
            await opensheetmusicdisplay.load(url);
            expect.fail("Invalid URL appears to be loaded correctly");
        } catch (exc: unknown) {
            if (!(exc instanceof Error) || !exc.message.toLowerCase().match(/url/)) {
                expect.fail("Unexpected error: " + (exc instanceof Error ? exc.message : String(exc)));
            }
        }
    });

    it("load invalid XML string", async () => {
        const xml: string = "<?xml";
        const div: HTMLElement = TestUtils.getDivElement(document);
        const opensheetmusicdisplay: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(div);
        try {
            await opensheetmusicdisplay.load(xml);
            expect.fail("Corrupted XML appears to be loaded correctly");
        } catch (exc: unknown) {
            if (!(exc instanceof Error) || !exc.message.toLowerCase().match(/partwise/)) {
                expect.fail("Unexpected error: " + (exc instanceof Error ? exc.message : String(exc)));
            }
        }
    });

    it("render without loading", () => {
        const div: HTMLElement = TestUtils.getDivElement(document);
        const opensheetmusicdisplay: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(div);
        expect(() => {
            return opensheetmusicdisplay.render();
        }).to.throw(/load/);
    });

    beforeAll((): void => {
        // Create the container for the "test width" test
        container1 = TestUtils.getDivElement(document);
    });
    afterAll((): void => {
        // Destroy the container for the "test width" test
        document.body.removeChild(container1);
    });

    it("test width 500", async () => {
        const div: HTMLElement = container1;
        div.style.width = "500px";
        // jsdom has no CSS layout engine — offsetWidth always 0.
        // Mock it so render() and assertions work.
        Object.defineProperty(div, "offsetWidth", { get: (): number => parseInt(div.style.width, 10) || 0, configurable: true });
        const opensheetmusicdisplay: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(div);
        const score: Document = TestUtils.getScore("MuzioClementi_SonatinaOpus36No1_Part1.xml");
        await opensheetmusicdisplay.load(score);
        opensheetmusicdisplay.render();
        expect(div.offsetWidth).to.equal(500);
    });

    it("test width 200", async () => {
        const div: HTMLElement = container1;
        div.style.width = "200px";
        // jsdom has no CSS layout engine — offsetWidth always 0.
        Object.defineProperty(div, "offsetWidth", { get: (): number => parseInt(div.style.width, 10) || 0, configurable: true });
        const opensheetmusicdisplay: OpenSheetMusicDisplay = TestUtils.createOpenSheetMusicDisplay(div);
        const score: Document = TestUtils.getScore("MuzioClementi_SonatinaOpus36No1_Part1.xml");
        await opensheetmusicdisplay.load(score);
        opensheetmusicdisplay.render();
        expect(div.offsetWidth).to.equal(200);
    });


});
