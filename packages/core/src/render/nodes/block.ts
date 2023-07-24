import { RenderNode } from '.';
import { BaseRenderNode } from './base';

export interface BlockStyle {
    paddingTop: number;
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
    lineHeight: number;
}

export class BlockRenderNode extends BaseRenderNode<BlockStyle> {
    readonly type = 'block';

    readonly size: number;

    constructor(id: string, style: BlockStyle, readonly children: RenderNode[]) {
        super(id, style);
        this.size = children.reduce((size, child) => size + child.size, 0);
    }
}
