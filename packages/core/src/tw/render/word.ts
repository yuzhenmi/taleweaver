import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderWord<TStyle> extends IRenderNode<TStyle> {}

export abstract class RenderWord<TStyle> extends RenderNode<TStyle> implements IRenderWord<TStyle> {
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
