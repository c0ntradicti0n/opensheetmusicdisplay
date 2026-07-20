import { MultiExpression } from "../MultiExpression";

/** MusicXML pedal type — distinguishes damper/sustain, sostenuto, and soft (una corda). */
export enum PedalType {
    Sustain = "sustain",
    Sostenuto = "sostenuto",
    Soft = "soft",
}

export class Pedal {
    constructor(line: boolean = false, sign: boolean = true, pedalType: PedalType = PedalType.Sustain) {
        this.line = line;
        this.sign = sign;
        this.pedalType = pedalType;
    }

    private line: boolean;
    private sign: boolean;
    public pedalType: PedalType;
    public StaffNumber: number;
    public ParentStartMultiExpression: MultiExpression;
    public ParentEndMultiExpression: MultiExpression;
    public ChangeEnd: boolean = false;
    public ChangeBegin: boolean = false;
    /** Whether the pedal ends at the stave end (and not before the endNote) */
    public EndsStave: boolean = false;
    /** Whether the pedal begins at the stave beginning (and not before the startNote - e.g. for whole measure rest) */
    public BeginsStave: boolean = false;

    public get IsLine(): boolean {
        return this.line;
    }
    public get IsSign(): boolean {
        return this.sign;
    }
}
