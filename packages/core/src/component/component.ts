import { RenderNode } from '../render/nodes';

export type Component<TProps> = (id: string, props: Partial<TProps>, children: RenderNode[]) => RenderNode;
