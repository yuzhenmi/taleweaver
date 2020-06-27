import { ApplyAttribute } from '../../model/change/applyAttribute';
import { ReplaceChange } from '../../model/change/replace';
import { Fragment } from '../../model/fragment';
import { IModelNode } from '../../model/node';
import { Transformation } from '../../transform/transformation';
import { ICommandHandler } from '../command';
import { IComponentService } from '../../component/service';
import { generateId } from '../../util/id';

interface IFindNodeResult {
    node: IModelNode<any>;
    from: number;
    to: number;
    relativeFrom: number;
    relativeTo: number;
}

function findNodesByComponentIdAndPartId(
    node: IModelNode<any>,
    componentId: string,
    partId: string | null,
    from: number,
    to: number,
): IFindNodeResult[] {
    const results: IFindNodeResult[] = [];
    if (node.componentId === componentId && node.partId === partId) {
        let adjustedFrom = from;
        let adjustedTo = to;
        if (from !== 0 || to !== node.size) {
            adjustedFrom = Math.max(1, adjustedFrom);
            adjustedTo = Math.min(node.size - 1, adjustedTo);
        }
        if (adjustedFrom < adjustedTo) {
            results.push({
                node,
                from: adjustedFrom,
                to: adjustedTo,
                relativeFrom: adjustedFrom,
                relativeTo: adjustedTo,
            });
        }
    }
    let cumulatedOffset = 1;
    node.children.forEach((child) => {
        if (cumulatedOffset <= to && from <= cumulatedOffset + child.size) {
            const childFrom = Math.max(0, from - cumulatedOffset);
            const childTo = Math.min(child.size, to - cumulatedOffset);
            results.push(
                ...findNodesByComponentIdAndPartId(child, componentId, partId, childFrom, childTo).map(
                    (childResult) => ({
                        ...childResult,
                        from: cumulatedOffset + childResult.from,
                        to: cumulatedOffset + childResult.to,
                    }),
                ),
            );
        }
        cumulatedOffset += child.size;
    });
    return results;
}

function cloneNodeWithAttribute(
    node: IModelNode<any>,
    attributeKey: string,
    attributeValue: any,
    from: number,
    to: number,
    componentService: IComponentService,
) {
    const component = componentService.getComponent(node.componentId);
    if (node.leaf) {
        const textFrom = Math.max(0, from - 1);
        const textTo = Math.min(node.text.length, to - 1);
        return component.buildModelNode(
            node.partId,
            generateId(),
            node.text.substring(textFrom, textTo),
            { ...node.attributes, [attributeKey]: attributeValue },
            [],
        );
    }
    const children: IModelNode<any>[] = [];
    let cumulatedOffset = 1;
    node.children.forEach((child) => {
        const childFrom = Math.max(0, from - cumulatedOffset);
        const childTo = Math.min(child.size, to - cumulatedOffset);
        if (cumulatedOffset <= to && from <= cumulatedOffset + child.size) {
            children.push(
                cloneNodeWithAttribute(child, attributeKey, attributeValue, childFrom, childTo, componentService),
            );
        }
        cumulatedOffset += child.size;
    });
    return component.buildModelNode(
        node.partId,
        generateId(),
        '',
        { ...node.attributes, [attributeKey]: attributeValue },
        children,
    );
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
    const findResults = findNodesByComponentIdAndPartId(
        modelService.getRoot(),
        componentId,
        partId,
        modelFrom,
        modelTo,
    );
    transformService.applyTransformation(
        new Transformation(
            findResults
                .filter((findResult) => findResult.node.attributes[attributeKey] !== attributeValue)
                .map((findResult) => new ApplyAttribute(buildPath(findResult.node), attributeKey, attributeValue)),
        ),
    );
};

export const applyAttributeWithin: ICommandHandler = async (
    serviceRegistry,
    componentId: string,
    partId: string | null,
    attributeKey: string,
    attributeValue: any,
) => {
    const transformService = serviceRegistry.getService('transform');
    const componentService = serviceRegistry.getService('component');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const modelService = serviceRegistry.getService('model');
    const { anchor, head } = cursorService.getCursor();
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    const modelFrom = renderService.convertOffsetToModelOffset(from);
    const modelTo = renderService.convertOffsetToModelOffset(to);
    const findResults = findNodesByComponentIdAndPartId(
        modelService.getRoot(),
        componentId,
        partId,
        modelFrom,
        modelTo,
    );
    transformService.applyTransformation(
        new Transformation(
            findResults
                .filter((findResult) => findResult.node.attributes[attributeKey] !== attributeValue)
                .map((findResult) => {
                    if (findResult.relativeFrom === 0 && findResult.relativeTo === findResult.node.size) {
                        return new ApplyAttribute(buildPath(findResult.node), attributeKey, attributeValue);
                    }
                    return new ReplaceChange(findResult.from, findResult.to, [
                        new Fragment(
                            [
                                cloneNodeWithAttribute(
                                    findResult.node,
                                    attributeKey,
                                    attributeValue,
                                    findResult.relativeFrom,
                                    findResult.relativeTo,
                                    componentService,
                                ),
                            ],
                            1,
                        ),
                    ]);
                }),
        ),
    );
};
