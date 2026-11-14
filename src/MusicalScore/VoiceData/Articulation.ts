import { PlacementEnum } from "./Expressions/AbstractExpression";
import { ArticulationEnum } from "./VoiceEntry";

export class Articulation {
    public placement: PlacementEnum;
    // TODO distinguish and save both placementXML and placementRendered
    public articulationEnum: ArticulationEnum;
    /** The color attribute of its element (as a notehead's), undefined: the default. */
    public color: string;

    constructor(articulationEnum: ArticulationEnum, placement: PlacementEnum) {
        this.articulationEnum = articulationEnum;
        this.placement = placement; // undefined by default, to not restrict placement
    }

    public Equals(otherArticulation: Articulation): boolean {
        return otherArticulation.articulationEnum === this.articulationEnum && otherArticulation.placement === this.placement;
    }
}
