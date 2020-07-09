import { IComponentService } from '../../component/service';
import { ApplyAttribute } from '../../model/change/apply-attribute';
import { ReplaceChange } from '../../model/change/replace';
import { IFragment } from '../../model/fragment';
import { IModelNode } from '../../model/node';
import { IModelPosition, IResolvedModelPosition } from '../../model/position';
import { Transformation } from '../../transform/transformation';
import { generateId } from '../../util/id';
import { ICommandHandler } from '../command';

interface IFindNodesResult {
    node: IModelNode<any>;
    position: IModelPosition;
    from: number;
    to: number;
}

function findNodesByComponentIdAndPartId(
    node: IModelNode<any>,
    componentId: string,
    partId: string | null,
    from: IResolvedModelPosition | null,
    to: IResolvedModelPosition | null,
    position: IModelPosition = [],
): IFindNodesResult[] {
    const results: IFindNodesResult[] = [];
    if (node.componentId === componentId && node.partId === partId) {
        results.push({
            node,
            position,
            from: from ? from[0].offset : 0,
            to: to ? to[0].offset : node.contentLength,
        });
    }
    if (!node.leaf) {
        const fromOffset = from ? from[0].offset : 0;
        const toOffset = to ? to[0].offset : node.contentLength - 1;
        for (let n = fromOffset; n <= toOffset; n++) {
            const child = node.children.at(n);
            results.push(
                ...findNodesByComponentIdAndPartId(
                    child,
                    componentId,
                    partId,
                    from && n === fromOffset ? from.slice(1) : null,
                    to && n === toOffset ? to.slice(1) : null,
                    [...position, n],
                ),
            );
        }
    }
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
        const textFrom = Math.max(0, from);
        const textTo = Math.min(node.text.length, to);
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

function getNodeEdgeDepth(node: IModelNode<any>) {
    let currentNode: IModelNode<any> | null = node;
    let depth = -1;
    while (currentNode) {
        depth++;
        currentNode = currentNode.firstChild;
    }
    return depth;
}

function buildModelPosition(node: IModelNode<any>) {
    const position: IModelPosition = [];
    let currentNode = node;
    while (currentNode.parent) {
        position.unshift(currentNode.parent.children.indexOf(currentNode));
        currentNode = currentNode.parent;
    }
    return position;
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
    const modelFrom = renderService.convertRenderToModelPosition(from);
    const modelTo = renderService.convertRenderToModelPosition(to);
    const newModelOffset = [...modelFrom];
    newModelOffset[newModelOffset.length - 1] += content.length;
    transformService.applyTransformation(
        new Transformation([new ReplaceChange(modelFrom, modelTo, [content])], newModelOffset),
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
    const modelFrom = renderService.convertRenderToModelPosition(from);
    const modelTo = renderService.convertRenderToModelPosition(to);
    transformService.applyTransformation(new Transformation([new ReplaceChange(modelFrom, modelTo, [''])], modelFrom));
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
    const modelFrom = renderService.convertRenderToModelPosition(from);
    const modelTo = renderService.convertRenderToModelPosition(to);
    transformService.applyTransformation(new Transformation([new ReplaceChange(modelFrom, modelTo, [''])], modelFrom));
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
    const modelFrom = renderService.convertRenderToModelPosition(from);
    const modelTo = renderService.convertRenderToModelPosition(to);
    const newModelOffset = [...modelFrom];
    newModelOffset[newModelOffset.length - 3]++;
    newModelOffset[newModelOffset.length - 2] = 0;
    newModelOffset[newModelOffset.length - 1] = 0;
    transformService.applyTransformation(
        new Transformation([new ReplaceChange(modelFrom, modelTo, ['', [], [], [], ''])], newModelOffset),
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
    const componentService = serviceRegistry.getService('component');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const modelService = serviceRegistry.getService('model');
    const { anchor, head } = cursorService.getCursor();
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);
    const modelFrom = renderService.convertRenderToModelPosition(from);
    const modelTo = renderService.convertRenderToModelPosition(to);
    const findResults = findNodesByComponentIdAndPartId(
        modelService.getRoot(),
        componentId,
        partId,
        modelService.resolvePosition(modelFrom),
        modelService.resolvePosition(modelTo),
    );
    transformService.applyTransformation(
        new Transformation(
            findResults
                .filter(({ node }) => node.attributes[attributeKey] !== attributeValue)
                .filter(({ node, from: nodeFrom, to: nodeTo }) => nodeFrom !== nodeTo || node.contentLength === 0)
                .map(({ node, position: nodePosition, from: nodeFrom, to: nodeTo }) => {
                    if (nodeFrom === 0 && nodeTo === node.size) {
                        return new ApplyAttribute(nodePosition, attributeKey, attributeValue);
                    }
                    const newNode = cloneNodeWithAttribute(
                        node,
                        attributeKey,
                        attributeValue,
                        nodeFrom,
                        nodeTo,
                        componentService,
                    );
                    const depth = getNodeEdgeDepth(newNode);
                    const fragment: IFragment = [
                        [
                            cloneNodeWithAttribute(
                                node,
                                attributeKey,
                                attributeValue,
                                nodeFrom,
                                nodeTo,
                                componentService,
                            ),
                        ],
                    ];
                    for (let n = 0; n < depth; n++) {
                        fragment.unshift([]);
                        fragment.push([]);
                    }
                    fragment.unshift('');
                    fragment.push('');
                    return new ReplaceChange([...nodePosition, nodeFrom], [...nodePosition, nodeTo], fragment);
                }),
        ),
    );
};

export const applyAttributeAround: ICommandHandler = async (
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
    const modelFrom = renderService.convertRenderToModelPosition(from);
    const modelTo = renderService.convertRenderToModelPosition(to);
    const findResults = findNodesByComponentIdAndPartId(
        modelService.getRoot(),
        componentId,
        partId,
        modelService.resolvePosition(modelFrom),
        modelService.resolvePosition(modelTo),
    );
    transformService.applyTransformation(
        new Transformation(
            findResults.map(({ node }) => new ApplyAttribute(buildModelPosition(node), attributeKey, attributeValue)),
        ),
    );
};
