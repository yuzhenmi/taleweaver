import { BlockStyle } from './nodes/block';
import { DocStyle } from './nodes/doc';
import { InlineStyle } from './nodes/inline';

export interface DocRenderSpec {
    style: DocStyle;
}

export interface BlockRenderSpec {
    style: BlockStyle;
}

export interface InlineRenderSpec {
    style: InlineStyle;
}
