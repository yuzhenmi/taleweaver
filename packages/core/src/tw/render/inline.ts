import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderInline<TStyle> extends IRenderNode<TStyle> {
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
}

export abstract class RenderInline<TStyle> extends RenderNode<TStyle> implements IRenderInline<TStyle> {
    abstract get paddingTop(): number;
    abstract get paddingBottom(): number;
    abstract get paddingLeft(): number;
    abstract get paddingRight(): number;

    get type(): IRenderNodeType {
        return 'inline';
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }

    get modelTextSize() {
        return 0;
    }
}
