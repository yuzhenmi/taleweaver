import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderDoc<TStyle> extends IRenderNode<TStyle> {
    readonly width: number;
    readonly height: number;
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
}

export abstract class RenderDoc<TStyle> extends RenderNode<TStyle> implements RenderDoc<TStyle> {
    abstract get width(): number;
    abstract get height(): number;
    abstract get paddingTop(): number;
    abstract get paddingBottom(): number;
    abstract get paddingLeft(): number;
    abstract get paddingRight(): number;

    get type(): IRenderNodeType {
        return 'doc';
    }

    get root() {
        return true;
    }

    get leaf() {
        return false;
    }

    get modelTextSize() {
        return 0;
    }
}
