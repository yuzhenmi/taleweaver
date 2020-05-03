import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderDoc<TStyle> extends IRenderNode<TStyle> {}

export abstract class RenderDoc<TStyle> extends RenderNode<TStyle> implements RenderDoc<TStyle> {
    constructor(componentId: string, id: string, style: TStyle, children: IRenderNode<any>[]) {
        super(componentId, id, style, children, '');
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

    get modelTextSize() {
        return 0;
    }
}
