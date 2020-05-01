import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderBlock<TStyle> extends IRenderNode<TStyle> {}

export abstract class RenderBlock<TStyle> extends RenderNode<TStyle> implements IRenderBlock<TStyle> {
    constructor(componentId: string, id: string, style: TStyle) {
        super(componentId, id, style, '');
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

    get modelTextSize() {
        return 0;
    }
}
