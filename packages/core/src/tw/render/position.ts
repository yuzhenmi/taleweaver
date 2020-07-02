import { IRenderNode } from './node';

export type IRenderPosition = number;

export interface IResolvedRenderOffset {
    node: IRenderNode<any, any>;
    offset: number;
    position: IRenderPosition;
}

export type IResolvedRenderPosition = IResolvedRenderOffset[];
