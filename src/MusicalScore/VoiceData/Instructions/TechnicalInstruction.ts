import { PlacementEnum } from "../Expressions/AbstractExpression";
import { Note } from "../Note";

export enum TechnicalInstructionType {
    Fingering,
    String,
}
export class TechnicalInstruction {
    public type: TechnicalInstructionType;
    public value: string;
    public placement: PlacementEnum;
    public sourceNote: Note;
    /** Whether this fingering is a substitution (replaces another fingering). */
    public substitution: boolean = false;
    /** To be able to set fontFamily for fingerings, e.g. (after load, before render):
     * Note that staffEntry.FingeringInstructions is only created during render(),
     *   so it's no use setting it there before render.
     */
    public fontFamily: string;
}
