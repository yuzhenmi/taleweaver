import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderWord<TStyle> extends IRenderNode<TStyle> {
    readonly breakableAfter: boolean;
}

export abstract class RenderWord<TStyle> extends RenderNode<TStyle> implements IRenderWord<TStyle> {
    protected internalBreakableAfter: boolean;

    constructor(componentId: string, id: string, style: TStyle, text: string, breakableAfter: boolean) {
        super(componentId, id, style, [], text);
        this.internalBreakableAfter = breakableAfter;
    }

    get type(): IRenderNodeType {
        return 'word';
    }

    get root() {
        return false;
    }

    get leaf() {
        return true;
    }

    get padModelSize() {
        return false;
    }

    get modelTextSize() {
        return 0;
    }

    get breakableAfter() {
        return this.internalBreakableAfter;
    }

    apply(node: this) {
        this.internalBreakableAfter = node.breakableAfter;
        super.apply(node);
    }
}
