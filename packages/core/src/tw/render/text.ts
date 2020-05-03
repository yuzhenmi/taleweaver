import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderText<TStyle> extends IRenderNode<TStyle> {}

export abstract class RenderText<TStyle> extends RenderNode<TStyle> implements IRenderText<TStyle> {
    constructor(componentId: string, id: string, children: IRenderNode<any>[], style: TStyle) {
        super(componentId, id, style, children, '');
    }

    get type(): IRenderNodeType {
        return 'text';
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }

    get padModelSize() {
        return false;
    }

    get modelTextSize() {
        return 0;
    }
}
