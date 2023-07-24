import { ComponentService } from '../component/service';
import { ModelNode } from './node';

interface SerializedMarkData {
    typeId: string;
    start: number;
    end: number;
    props: unknown;
}

/**
 * Data that can be easily transmitted and stored.
 */
export interface SerializedData {
    componentId: string;
    id: string;
    props?: unknown;
    marks?: SerializedMarkData[];
    children?: Array<SerializedData | string>;
}

/**
 * Serializes and deserializes the document.
 */
export class Serializer {
    constructor(protected componentService: ComponentService) {}

    /**
     * Deserializes data into a node.
     * @param data Serialized data.
     * @returns The deserialized node.
     */
    parse(data: SerializedData): ModelNode<unknown> {
        const children: Array<string | ModelNode<unknown>> = [];
        if (data.children) {
            let substring = '';
            for (const childData of data.children) {
                if (typeof childData === 'string') {
                    substring += childData;
                } else {
                    if (substring) {
                        children.push(substring);
                    }
                    substring = '';
                    children.push(this.parse(childData));
                }
            }
            if (substring) {
                children.push(substring);
            }
        }
        return new ModelNode({
            componentId: data.componentId,
            id: data.id,
            props: data.props ?? {},
            marks: data.marks ?? [],
            children,
        });
    }

    /**
     * Serializes a node.
     * @param node The node to serialize.
     * @returns The serialized data.
     */
    serialize(node: ModelNode<unknown>): SerializedData {
        const data: SerializedData = {
            componentId: node.componentId,
            id: node.id,
            props: node.props,
        };
        if (node.marks.length > 0) {
            data.marks = node.marks.map((mark) => ({
                typeId: mark.typeId,
                start: mark.start,
                end: mark.end,
                props: mark.props,
            }));
        }
        if (node.children.length > 0) {
            data.children = [];
            let substring = '';
            for (const child of node.children) {
                if (typeof child === 'string') {
                    substring += child;
                } else {
                    if (substring) {
                        data.children.push(substring);
                    }
                    substring = '';
                    data.children.push(this.serialize(child));
                }
            }
            if (substring) {
                data.children.push(substring);
            }
        }
        return data;
    }
}
