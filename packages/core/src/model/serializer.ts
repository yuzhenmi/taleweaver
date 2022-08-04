import { ComponentService } from '../component/service';
import { ModelNode } from './nodes';
import { BlockModelNode, BlockModelNodeChild } from './nodes/block';
import { DocModelChildNode, DocModelNode } from './nodes/doc';
import { InlineModelNode } from './nodes/inline';

export interface ModelNodeData {
    componentId: string;
    id: string;
    attributes: any;
    children?: Array<ModelNodeData | string>;
    marks?: Array<{
        typeId: string;
        start: number;
        end: number;
        attributes: any;
    }>;
}

export class Serializer {
    constructor(protected componentService: ComponentService) {}

    parse(data: ModelNodeData): DocModelNode<any> {
        const doc = this._parse(data);
        if (doc.type !== 'doc') {
            throw new Error('Serializable is invalid.');
        }
        return doc;
    }

    serialize(doc: DocModelNode<any>): ModelNodeData {
        return this._serialize(doc);
    }

    protected _parse(data: ModelNodeData): ModelNode {
        const component = this.componentService.getComponent(data.componentId);
        switch (component.type) {
            case 'doc': {
                const children =
                    data.children?.map((childData) => {
                        if (typeof childData === 'string') {
                            throw new Error('Doc child data must be object.');
                        }
                        const child = this._parse(childData);
                        if (!['block'].includes(child.type)) {
                            throw new Error('Doc child must be block.');
                        }
                        return child as DocModelChildNode;
                    }) ?? [];
                return new DocModelNode(data.componentId, data.id, data.attributes, children);
            }
            case 'block': {
                const children: BlockModelNodeChild[] = [];
                if (data.children) {
                    for (let n = 0, nn = data.children.length; n < nn; n++) {
                        const childData = data.children[n];
                        if (typeof childData === 'string') {
                            children.push(...childData.split(''));
                        } else {
                            const child = this._parse(childData);
                            if (!['inline'].includes(child.type)) {
                                throw new Error('Block child must be inline.');
                            }
                            children.push(child as BlockModelNodeChild);
                        }
                    }
                }
                return new BlockModelNode(data.componentId, data.id, data.attributes, data.marks ?? [], children);
            }
            case 'inline': {
                return new InlineModelNode(data.componentId, data.id, data.attributes);
            }
        }
    }

    protected _serialize(node: ModelNode): ModelNodeData {
        const result: ModelNodeData = {
            componentId: node.componentId,
            id: node.id,
            attributes: node.attributes,
        };
        switch (node.type) {
            case 'doc': {
                result.children = node.children.map(this._serialize);
                break;
            }
            case 'block': {
                result.marks = node.marks.slice();
                result.children = [];
                let substring = '';
                for (const child of node.children) {
                    if (typeof child === 'string') {
                        substring += child;
                    } else {
                        result.children.push(substring);
                        substring = '';
                        result.children.push(this._serialize(child));
                    }
                }
                if (substring) {
                    result.children.push(substring);
                }
                break;
            }
        }
        return result;
    }
}
