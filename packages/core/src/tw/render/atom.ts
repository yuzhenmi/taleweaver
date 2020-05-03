import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderAtom<TStyle> extends IRenderNode<TStyle> {
    readonly breakableAfter: boolean;
}

export abstract class RenderAtom<TStyle> extends RenderNode<TStyle> implements IRenderAtom<TStyle> {
    protected internalBreakableAfter: boolean;

    constructor(componentId: string, id: string, style: TStyle, breakableAfter: boolean) {
        super(componentId, id, style, [], ' ');
        this.internalBreakableAfter = breakableAfter;
    }

    get type(): IRenderNodeType {
        return 'atom';
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
        return 1;
    }

    get breakableAfter() {
        return this.internalBreakableAfter;
    }

    apply(node: this) {
        this.internalBreakableAfter = node.breakableAfter;
        super.apply(node);
    }
}
