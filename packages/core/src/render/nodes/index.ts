import { DocRenderNode } from './doc';
import { BlockRenderNode } from './block';
import { InlineRenderNode } from './inline';
import { TextRenderNode } from './text';

export type RenderNode = DocRenderNode | BlockRenderNode | InlineRenderNode | TextRenderNode;
