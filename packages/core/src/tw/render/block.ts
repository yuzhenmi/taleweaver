import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderBlock<TStyle, TAttributes> extends IRenderNode<TStyle, TAttributes> {
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
}

export abstract class RenderBlock<TStyle, TAttributes> extends RenderNode<TStyle, TAttributes>
    implements IRenderBlock<TStyle, TAttributes> {
    abstract get paddingTop(): number;
    abstract get paddingBottom(): number;
    abstract get paddingLeft(): number;
    abstract get paddingRight(): number;

    constructor(
        componentId: string,
        modelId: string | null,
        attributes: TAttributes,
        children: IRenderNode<any, any>[],
    ) {
        super(componentId, modelId, '', attributes, children);
    }

    get type(): IRenderNodeType {
        return 'block';
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }
}
