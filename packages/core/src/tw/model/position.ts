import { IModelNode } from './node';

export type IModelPosition = number[];

export interface IResolvedModelOffset {
    offset: number;
    node: IModelNode<any>;
}

export type IResolvedModelPosition = IResolvedModelOffset[];
