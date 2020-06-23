import { ApplyAttribute } from '../../model/change/applyAttribute';
import { ReplaceChange } from '../../model/change/replace';
import { Fragment } from '../../model/fragment';
import { IModelNode } from '../../model/node';
import { Transformation } from '../../transform/transformation';
import { ICommandHandler } from '../command';

function findNodesByComponentIdAndPartId(
    node: IModelNode<any>,
    componentId: string,
    partId: string | null,
    searchFrom: number,
    searchTo: number,
): IModelNode<any>[] {
    const nodes: IModelNode<any>[] = [];
    if (node.componentId === componentId && node.partId === partId) {
        nodes.push(node);
    }
    let cumulatedOffset = 1;
    node.children.forEach((child) => {
        if (cumulatedOffset <= searchTo && searchFrom <= cumulatedOffset + child.size) {
            const searchChildFrom = Math.max(0, searchFrom - cumulatedOffset);
            const searchChildTo = Math.min(child.size, searchTo - cumulatedOffset);
            nodes.push(...findNodesByComponentIdAndPartId(child, componentId, partId, searchChildFrom, searchChildTo));
        }
        cumulatedOffset += child.size;
    });
    return nodes;
}

function buildPath(node: IModelNode<any>) {
    const path: string[] = [];
    let currentNode: IModelNode<any> | null = node;
    while (currentNode) {
        path.unshift(currentNode.id);
        currentNode = currentNode.parent;
    }
    return path;
}

export const insert: ICommandHandler = async (serviceRegistry, content: string) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    const modelFrom = renderService.convertOffsetToModelOffset(from);
    const modelTo = renderService.convertOffsetToModelOffset(to);
    const newModelOffset = modelFrom + content.length;
    transformService.applyTransformation(
        new Transformation([new ReplaceChange(modelFrom, modelTo, [new Fragment(content, 0)])], newModelOffset),
    );
};

export const deleteBackward: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    let from: number;
    let to: number;
    if (anchor === head) {
        if (head === 0) {
            return;
        }
        from = head - 1;
        to = head;
    } else {
        from = Math.min(anchor, head);
        to = Math.max(anchor, head);
    }
    const modelFrom = renderService.convertOffsetToModelOffset(from);
    const modelTo = renderService.convertOffsetToModelOffset(to);
    transformService.applyTransformation(new Transformation([new ReplaceChange(modelFrom, modelTo, [])], modelFrom));
};

export const deleteForward: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    let from: number;
    let to: number;
    if (anchor === head) {
        if (head >= renderService.getDocSize() - 1) {
            return;
        }
        from = head;
        to = head + 1;
    } else {
        from = Math.min(anchor, head);
        to = Math.max(anchor, head);
    }
    const modelFrom = renderService.convertOffsetToModelOffset(from);
    const modelTo = renderService.convertOffsetToModelOffset(to);
    transformService.applyTransformation(new Transformation([new ReplaceChange(modelFrom, modelTo, [])], modelFrom));
};

export const breakLine: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    const modelFrom = renderService.convertOffsetToModelOffset(from);
    const modelTo = renderService.convertOffsetToModelOffset(to);
    const newModelOffset = modelFrom + 4;
    transformService.applyTransformation(
        new Transformation([new ReplaceChange(modelFrom, modelTo, [new Fragment([], 2)])], newModelOffset),
    );
};

export const applyAttribute: ICommandHandler = async (
    serviceRegistry,
    componentId: string,
    partId: string | null,
    attributeKey: string,
    attributeValue: any,
) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const modelService = serviceRegistry.getService('model');
    const { anchor, head } = cursorService.getCursor();
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    const modelFrom = renderService.convertOffsetToModelOffset(from);
    const modelTo = renderService.convertOffsetToModelOffset(to);
    const nodes = findNodesByComponentIdAndPartId(modelService.getRoot(), componentId, partId, modelFrom, modelTo);
    transformService.applyTransformation(
        new Transformation(nodes.map((node) => new ApplyAttribute(buildPath(node), attributeKey, attributeValue))),
    );
};
