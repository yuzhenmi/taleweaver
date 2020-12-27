import { IComponentService } from '../component/service';
import {
    BlockModelNode,
    DocModelNode,
    IDocModelNode,
    IInlineModelNode,
    IModelNode,
    InlineModelNode,
} from './node';

type ISerializableValue =
    | number
    | string
    | boolean
    | ISerializableValue[]
    | { [key: string]: ISerializableValue };

export interface ISerializable {
    componentId: string;
    id: string;
    attributes: { [key: string]: ISerializableValue };
    children?: ISerializable[];
    content?: string;
    marks?: Array<{
        typeId: string;
        start: number;
        end: number;
        attributes: { [key: string]: ISerializableValue };
    }>;
}

export class Serializer {
    constructor(protected componentService: IComponentService) {}

    parse(data: ISerializable): IDocModelNode {
        const doc = this.internalParse(data);
        if (doc.type !== 'doc') {
            throw new Error('Serializable is invalid.');
        }
        return doc;
    }

    serialize(doc: IDocModelNode): ISerializable {
        return this.internalSerialize(doc);
    }

    protected internalParse(data: ISerializable): IModelNode {
        const component = this.componentService.getComponent(data.componentId);
        switch (component.type) {
            case 'doc': {
                const node = new DocModelNode(data.componentId, data.id);
                for (const key in data.attributes) {
                    node.setAttribute(key, data.attributes[key]);
                }
                data.children?.forEach((childData, childIndex) => {
                    const child = this.internalParse(childData);
                    if (child.type !== 'block') {
                        throw new Error('Child of doc must be block.');
                    }
                    node.insertChild(child, childIndex);
                });
                return node;
            }
            case 'block': {
                const node = new BlockModelNode(data.componentId, data.id);
                for (const key in data.attributes) {
                    node.setAttribute(key, data.attributes[key]);
                }
                data.marks?.forEach((mark) => {
                    node.appendMark(mark);
                });
                const content: Array<string | IInlineModelNode> = [];
                const dataContent = data.content ?? '';
                const dataChildren = data.children ?? [];
                let m = 0;
                for (let n = 0, nn = dataContent.length; n < nn; n++) {
                    let character = dataContent[n];
                    let characterOrInlineNode: string | IInlineModelNode;
                    if (character === '$') {
                        if (n + 1 < nn && dataContent[n + 1] === '$') {
                            n++;
                            characterOrInlineNode = '$';
                        } else {
                            if (m >= dataChildren.length) {
                                throw new Error(
                                    'Expected additional children in block node.',
                                );
                            }
                            const inlineNode = this.internalParse(
                                dataChildren[m],
                            );
                            if (inlineNode.type !== 'inline') {
                                throw new Error(
                                    'Expected block node child as inline node.',
                                );
                            }
                            characterOrInlineNode = inlineNode;
                        }
                    } else {
                        characterOrInlineNode = character;
                    }
                    content.push(characterOrInlineNode);
                }
                node.insertContent(content, 0);
                return node;
            }
            case 'inline': {
                const node = new InlineModelNode(data.componentId, data.id);
                for (const key in data.attributes) {
                    node.setAttribute(key, data.attributes[key]);
                }
                return node;
            }
        }
    }

    protected internalSerialize(node: IModelNode): ISerializable {
        const result: ISerializable = {
            componentId: node.componentId,
            id: node.id,
            attributes: node.attributes as any,
        };
        switch (node.type) {
            case 'doc': {
                result.children = node.children.map(this.internalSerialize);
                break;
            }
            case 'block': {
                result.content = '';
                result.children = [];
                node.content
                    .slice(0, node.content.length - 1)
                    .forEach((characterOrInlineNode) => {
                        if (typeof characterOrInlineNode === 'string') {
                            if (characterOrInlineNode === '$') {
                                result.content += '$$';
                            } else {
                                result.content += characterOrInlineNode;
                            }
                        } else {
                            result.content += '$';
                            result.children!.push(
                                this.internalSerialize(characterOrInlineNode),
                            );
                        }
                    });
                result.marks = node.marks as any;
                break;
            }
        }
        return result;
    }
}
