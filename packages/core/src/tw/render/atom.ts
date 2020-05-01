import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderAtom<TStyle> extends IRenderNode<TStyle> {}

export abstract class RenderAtom<TStyle> extends RenderNode<TStyle> implements IRenderAtom<TStyle> {
    constructor(componentId: string, id: string, style: TStyle) {
        super(componentId, id, style, ' ');
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
}
