import { IRenderNode } from './node';

export type IRenderPosition = number;

export interface IResolvedOffset {
    offset: number;
    node: IRenderNode<any, any>;
}

export type IResolvedPosition = IResolvedOffset[];
