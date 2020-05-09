import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderDoc<TStyle> extends IRenderNode<TStyle> {}

export abstract class RenderDoc<TStyle> extends RenderNode<TStyle> implements RenderDoc<TStyle> {
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
