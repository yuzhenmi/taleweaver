import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderInline<TStyle> extends IRenderNode<TStyle> {}

export abstract class RenderInline<TStyle> extends RenderNode<TStyle> implements IRenderInline<TStyle> {
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
