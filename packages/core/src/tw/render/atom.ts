import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderAtom<TStyle> extends IRenderNode<TStyle> {
    readonly width: number;
    readonly height: number;
}

export abstract class RenderAtom<TStyle> extends RenderNode<TStyle> implements IRenderAtom<TStyle> {
    abstract get width(): number;
    abstract get height(): number;

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
