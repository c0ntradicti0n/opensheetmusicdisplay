import { MusicSheet } from "./MusicSheet";

export class InstrumentalGroup {

    constructor(name: string, musicSheet: MusicSheet, parent: InstrumentalGroup) {
        this.name = name;
        this.musicSheet = musicSheet;
        this.parent = parent;
    }

    private name: string;
    private musicSheet: MusicSheet;
    private parent: InstrumentalGroup;
    private instrumentalGroups: InstrumentalGroup[] = [];
    /** The part-group's <group-symbol> (brace, bracket, line, square), if any. */
    public GroupSymbol: string;
    /** The part-group's <group-barline>: whether bar lines run through the group; undefined if not given. */
    public GroupBarline: boolean;

    /** Bar lines run through the group: as given, else for a brace (one player, e.g. a piano as two parts). */
    public get ConnectsBarlines(): boolean {
        return this.GroupBarline ?? this.GroupSymbol === "brace";
    }

    /** The instruments in the group, nested groups included, in score order. */
    public get Instruments(): InstrumentalGroup[] {
        return this.instrumentalGroups.flatMap((group) => group.InstrumentalGroups.length > 0 ? (group as InstrumentalGroup).Instruments : [group]);
    }

    public get InstrumentalGroups(): InstrumentalGroup[] {
        return this.instrumentalGroups;
    }
    public get Parent(): InstrumentalGroup {
        return this.parent;
    }
    public get Name(): string {
        return this.name;
    }
    public set Name(value: string) {
        this.name = value;
    }
    public get GetMusicSheet(): MusicSheet {
        return this.musicSheet;
    }

}
