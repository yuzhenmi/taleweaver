import { IRenderNode } from './node';

export type IRenderPosition = number;

export interface IResolvedRenderOffset {
    offset: number;
    node: IRenderNode<any, any>;
}

export type IResolvedRenderPosition = IResolvedRenderOffset[];
