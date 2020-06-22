import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderDoc<TStyle, TAttributes> extends IRenderNode<TStyle, TAttributes> {
    readonly width: number;
    readonly height: number;
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
}

export abstract class RenderDoc<TStyle, TAttributes> extends RenderNode<TStyle, TAttributes>
    implements RenderDoc<TStyle, TAttributes> {
    abstract get width(): number;
    abstract get height(): number;
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
        return 'doc';
    }

    get root() {
        return true;
    }

    get leaf() {
        return false;
    }
}
