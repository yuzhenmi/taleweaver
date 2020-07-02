import { IModelNode } from './node';

export type IContent = IModelNode<any>[] | string;

export type IFragment = IContent[];
