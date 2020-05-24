import { INodeList, NodeList } from '../tree/node-list';
import { IModelNode } from './node';

export interface ISlice {
    readonly content: INodeList<IModelNode<any>>;
    readonly startOpen: number;
    readonly endOpen: number;
}

export class Slice implements ISlice {
    readonly content: INodeList<IModelNode<any>>;

    constructor(content: IModelNode<any>[], readonly startOpen: number, readonly endOpen: number) {
        this.content = new NodeList(content);
    }
}
