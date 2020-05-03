import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderInline<TStyle> extends IRenderNode<TStyle> {}

export abstract class RenderInline<TStyle> extends RenderNode<TStyle> implements IRenderInline<TStyle> {
    constructor(componentId: string, id: string, style: TStyle, children: IRenderNode<any>[]) {
        super(componentId, id, style, children, '');
    }

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
