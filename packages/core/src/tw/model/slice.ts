import { INodeList, NodeList } from '../tree/node-list';
import { IModelNode } from './node';

export interface ISlice {
    readonly content: INodeList<IModelNode<any>> | string;
    readonly startOpen: number;
    readonly endOpen: number;
}

export class Slice implements ISlice {
    readonly content: INodeList<IModelNode<any>> | string;

    constructor(content: IModelNode<any>[] | string, readonly startOpen: number, readonly endOpen: number) {
        if (Array.isArray(content)) {
            if (startOpen === 0 || endOpen === 0) {
                throw new Error('Slice of nodes cannot have start or end open of zero.');
            }
            this.content = new NodeList(content);
        } else {
            if (startOpen !== 0 || endOpen !== 0) {
                throw new Error('Slice of text must start or end open of zero.');
            }
            this.content = content;
        }
    }
}
