import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderAtom<TStyle, TAttributes> extends IRenderNode<TStyle, TAttributes> {
    readonly width: number;
    readonly height: number;
}

export abstract class RenderAtom<TStyle, TAttributes> extends RenderNode<TStyle, TAttributes>
    implements IRenderAtom<TStyle, TAttributes> {
    abstract get width(): number;
    abstract get height(): number;

    constructor(componentId: string, modelId: string | null, attributes: TAttributes) {
        super(componentId, modelId, ' ', attributes, []);
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

    get pseudo() {
        return true;
    }

    get text() {
        return ' ';
    }
}
