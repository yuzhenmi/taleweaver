import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderText<TStyle> extends IRenderNode<TStyle> {
    readonly breakableAfter: boolean;
}

export abstract class RenderText<TStyle> extends RenderNode<TStyle> implements IRenderText<TStyle> {
    constructor(componentId: string, id: string, style: TStyle, text: string, readonly breakableAfter: boolean) {
        super(componentId, id, style, text);
    }

    get type(): IRenderNodeType {
        return 'word';
    }

    get root() {
        return false;
    }

    get leaf() {
        return true;
    }

    get padModelSize() {
        return false;
    }

    get modelTextSize() {
        return 0;
    }
}
