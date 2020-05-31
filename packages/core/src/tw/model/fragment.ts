import { IModelNode } from './node';

export type IContentType = 'text' | 'nodes';

export interface IFragment {
    readonly content: IModelNode<any>[] | string;
    readonly depth: number;
    readonly contentType: IContentType;
    readonly size: number;
}

export class Fragment implements IFragment {
    readonly contentType: IContentType;
    readonly size: number;

    constructor(readonly content: IModelNode<any>[] | string, readonly depth: number) {
        if (Array.isArray(content)) {
            if (depth <= 0) {
                throw new Error('Fragment of nodes must have depth greater than zero.');
            }
            this.contentType = 'nodes';
            this.size = content.reduce((size, node) => size + node.size, 0);
        } else {
            if (depth !== 0) {
                throw new Error('Fragment of text must have depth of zero.');
            }
            this.contentType = 'text';
            this.size = content.length;
        }
    }
}
