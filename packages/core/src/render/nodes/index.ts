import { BlockRenderNode } from './block';
import { DocRenderNode } from './doc';
import { TextRenderNode } from './text';

export type RenderNode = DocRenderNode | BlockRenderNode | TextRenderNode;
