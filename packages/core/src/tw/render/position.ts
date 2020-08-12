import { IRenderNode } from './node';

export interface IResolvedOffset {
    offset: number;
    node: IRenderNode<any, any>;
}

export type IResolvedPosition = IResolvedOffset[];
