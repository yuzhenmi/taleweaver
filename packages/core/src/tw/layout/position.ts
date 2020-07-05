import { ILayoutNode } from './node';

export interface IResolvedOffset {
    offset: number;
    node: ILayoutNode;
}

export type IResolvedPosition = IResolvedOffset[];
