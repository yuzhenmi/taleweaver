import { INodeList, NodeList } from '../tree/node-list';
import { IModelNode } from './node';

export interface ISlice {
    readonly content: INodeList<IModelNode<any>> | string;
    readonly open: number;
}

export class Slice implements ISlice {
    readonly content: INodeList<IModelNode<any>> | string;

    constructor(content: IModelNode<any>[] | string, readonly open: number) {
        if (Array.isArray(content)) {
            if (open === 0) {
                throw new Error('Slice of nodes cannot have open of zero.');
            }
            this.content = new NodeList(content);
        } else {
            if (open !== 0) {
                throw new Error('Slice of text must have open of zero.');
            }
            this.content = content;
        }
    }
}
