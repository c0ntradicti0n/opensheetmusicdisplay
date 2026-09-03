import { MusicSheet } from "../../MusicSheet";
import { IXmlElement, IXmlAttribute } from "../../../Common/FileIO/Xml";
import { Slur } from "../../VoiceData/Expressions/ContinuousExpressions/Slur";
import { Note } from "../../VoiceData/Note";
import log from "loglevel";
import { ITextTranslation } from "../../Interfaces/ITextTranslation";
import { PlacementEnum } from "../../VoiceData/Expressions";
import { Glissando } from "../../VoiceData/Glissando";
import { SourceStaffEntry } from "../../VoiceData/SourceStaffEntry";

export class SlurReader {
    private musicSheet: MusicSheet;
    private openSlurDict: { [_: number]: Slur } = {};
    /** Slur stops that were read before their matching start, kept separate from openSlurDict so they don't
     * interfere with normal start-before-stop slurs that reuse the same slur number. See addSlur().
     * A number can accumulate several such stops within one measure (one per cross-voice phrase sharing that
     * number), so each entry is a queue consumed in read order by the matching starts. */
    private openStopBeforeStartDict: { [_: number]: Slur[] } = {};
    constructor(musicSheet: MusicSheet) {
        this.musicSheet = musicSheet;
    }
    public addSlur(slurNodes: IXmlElement[], currentNote: Note): void {
        try {
            if (slurNodes) {
                for (const slurNode of slurNodes) {
                    if (slurNode.attributes().length > 0) {
                        const type: string = slurNode.attribute("type").value;
                        let slurNumber: number = 1;
                        try {
                            const slurNumberAttribute: IXmlAttribute = slurNode.attribute("number");
                            if (slurNumberAttribute) {
                                slurNumber = parseInt(slurNode.attribute("number").value, 10);
                            }
                        } catch (ex) {
                            log.debug("VoiceGenerator.addSlur number: ", ex);
                        }

                        let slurPlacementXml: PlacementEnum = PlacementEnum.NotYetDefined;
                        const placementAttr: Attr = slurNode.attribute("placement");
                        if (placementAttr && placementAttr.value) {
                            if (placementAttr.value === "above") {
                                slurPlacementXml = PlacementEnum.Above;
                            } else if (placementAttr.value === "below") {
                                slurPlacementXml = PlacementEnum.Below;
                            }
                        }
                        // orientation is a deprecated alternative to placement (Sibelius):
                        // honor it only when placement didn't already set a value, so an
                        // explicit placement (or a flipped one) stays authoritative.
                        if (slurPlacementXml === PlacementEnum.NotYetDefined) {
                            const orientationAttr: Attr = slurNode.attribute("orientation");
                            if (orientationAttr && orientationAttr.value) {
                                if (orientationAttr.value === "over") {
                                    slurPlacementXml = PlacementEnum.Above;
                                } else if (orientationAttr.value === "under") {
                                    slurPlacementXml = PlacementEnum.Below;
                                }
                            }
                        }
                        if (type === "start") {
                            // A cross-staff slur's stop can be read before its start: MusicXML writes the end
                            // note's staff before a <backup> and the start note's staff after it, so for e.g. a
                            // left-hand-to-right-hand slur the stop appears before the start. Such a stop was
                            // deferred to openStopBeforeStartDict. Match this start to the earliest deferred
                            // stop of its number it genuinely belongs to (same measure, running forward in
                            // time); an unrelated stop - e.g. of another same-number phrase - is left queued
                            // for its own start.
                            let pendingCrossStaffStop: Slur = undefined;
                            if (slurNode.name === "slur") {
                                const deferredStops: Slur[] = this.openStopBeforeStartDict[slurNumber];
                                if (deferredStops) {
                                    const matchIndex: number = deferredStops.findIndex((stop: Slur) =>
                                        this.isCrossStaffSlurMatch(currentNote, stop.EndNote));
                                    if (matchIndex >= 0) {
                                        pendingCrossStaffStop = deferredStops.splice(matchIndex, 1)[0];
                                        if (deferredStops.length === 0) {
                                            delete this.openStopBeforeStartDict[slurNumber];
                                        }
                                    }
                                }
                            }
                            if (pendingCrossStaffStop) {
                                pendingCrossStaffStop.StartNote = currentNote;
                                pendingCrossStaffStop.PlacementXml = slurPlacementXml;
                                this.linkSlurToNotes(pendingCrossStaffStop);
                            } else {
                                let slur: Slur = this.openSlurDict[slurNumber];
                                if (!slur) {
                                    slur = new Slur();
                                    this.openSlurDict[slurNumber] = slur;
                                }
                                slur.StartNote = currentNote;
                                slur.PlacementXml = slurPlacementXml;
                            }
                        } else if (type === "stop") {
                            const nodeName: string = slurNode.name;
                            if (nodeName === "slide" || nodeName === "glissando") {
                                // TODO for now, we abuse the SlurReader to also process slides and glissandi, to avoid a lot of duplicate code.
                                //   though we might want to separate the code a bit, at least use its own openGlissDict instead of openSlurDict.
                                //   also see variable glissElements later on
                                const slur: Slur = this.openSlurDict[slurNumber];
                                if (slur) {
                                    const startNote: Note = slur.StartNote;
                                    const newGlissando: Glissando = new Glissando(startNote);
                                    newGlissando.AddNote(currentNote);
                                    newGlissando.EndNote = currentNote;
                                    currentNote.NoteGlissando = newGlissando;
                                    // TODO use its own dict, openSlideDict? Can this cause problems if slur and slide have the same number?
                                    delete this.openSlurDict[slurNumber];
                                }
                            } else {
                                const slur: Slur = this.openSlurDict[slurNumber];
                                if (slur) {
                                    // normal case: the matching start of this number was read first
                                    slur.EndNote = currentNote;
                                    this.linkSlurToNotes(slur);
                                    delete this.openSlurDict[slurNumber];
                                } else {
                                    // No open start with this number. Either a cross-staff slur whose start is
                                    // written after the stop (completed in the start branch above), or an orphan
                                    // stop with no start (e.g. a slur started on a grace note, whose start is
                                    // skipped by the reader - see VoiceGenerator). Defer it without touching
                                    // openSlurDict, so it can't disturb normal slurs that reuse this number.
                                    const deferredStop: Slur = new Slur();
                                    deferredStop.EndNote = currentNote;
                                    let deferredStops: Slur[] = this.openStopBeforeStartDict[slurNumber];
                                    if (!deferredStops) {
                                        deferredStops = [];
                                        this.openStopBeforeStartDict[slurNumber] = deferredStops;
                                    }
                                    deferredStops.push(deferredStop);
                                }
                            }
                        }
                    }
                }
            }
        } catch (err) {
            const errorMsg: string = ITextTranslation.translateText("ReaderErrorMessages/SlurError", "Error while reading slur.");
            this.musicSheet.SheetErrors.pushMeasureError(errorMsg);
        }
    }

    /** Links a fully-defined slur (both StartNote and EndNote set) to its two notes, unless it duplicates an existing one. */
    private linkSlurToNotes(slur: Slur): void {
        const endNote: Note = slur.EndNote;
        // check that a slur with the same notes hasn't already been added:
        if (!endNote.isDuplicateSlur(slur)) {
            endNote.NoteSlurs.push(slur);
            slur.StartNote.NoteSlurs.push(slur);
        }
    }

    /** Whether a slur stop that was read before its start (endNote) and a later start note (startNote) form a
     * genuine slur. The stop can be read before the start for two layouts, both kept within one measure by a
     * <backup>: a cross-staff slur (end note's staff is written first, then the start note's staff) and a
     * same-staff cross-voice slur (the main voice's stop is written before the secondary voice's start). Both
     * run strictly forward in time: the start note is always earlier than the stop note, so the pairing is only
     * accepted when start < stop. Requiring the same measure and strictly-forward time rejects orphan stops - e.g.
     * from grace-note slurs whose start is skipped by the reader - which would otherwise be wrongly paired with an
     * unrelated later start that reuses the same slur number. A stop and a start with equal timestamps are on the
     * same note (a slur ending and another starting at a phrase boundary, as with grace-note slurs), never a real
     * slur, so equality is rejected too. */
    private isCrossStaffSlurMatch(startNote: Note, endNote: Note): boolean {
        if (!startNote || !endNote) {
            return false;
        }
        const startStaffEntry: SourceStaffEntry = startNote.ParentStaffEntry;
        const endStaffEntry: SourceStaffEntry = endNote.ParentStaffEntry;
        if (!startStaffEntry || !endStaffEntry) {
            return false;
        }
        if (startNote.SourceMeasure !== endNote.SourceMeasure) {
            return false; // a stop-before-start slur is reordered within one measure
        }
        return endStaffEntry.Timestamp.RealValue > startStaffEntry.Timestamp.RealValue; // slur runs forward in time
    }
}
