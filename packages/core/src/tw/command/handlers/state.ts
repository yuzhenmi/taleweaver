import { ApplyAttribute } from '../../model/change/apply-attribute';
import { ReplaceChange } from '../../model/change/replace';
import { IModelNode } from '../../model/node';
import { IModelPosition, IResolvedModelPosition } from '../../model/position';
import { Transformation } from '../../transform/transformation';
import { ICommandHandler } from '../command';

function findNodesByComponentIdAndPartId(
    node: IModelNode<any>,
    componentId: string,
    partId: string | null,
    from: IResolvedModelPosition | null,
    to: IResolvedModelPosition | null,
): IModelNode<any>[] {
    const nodes: IModelNode<any>[] = [];
    if (node.componentId === componentId && node.partId === partId) {
        nodes.push(node);
    }
    const fromOffset = from ? from[0].offset : 0;
    const toOffset = to ? to[0].offset : node.contentLength - 1;
    for (let n = fromOffset; n <= toOffset; n++) {
        const child = node.children.at(n);
        nodes.push(
            ...findNodesByComponentIdAndPartId(
                child,
                componentId,
                partId,
                from && n === fromOffset ? from.slice(1) : null,
                to && n === toOffset ? to.slice(1) : null,
            ),
        );
    }
    return nodes;
}

function buildModelPosition(node: IModelNode<any>) {
    const position: IModelPosition = [];
    let currentNode = node;
    while (currentNode.parent) {
        position.unshift(currentNode.parent.children.indexOf(node));
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
        new Transformation([new ReplaceChange(modelFrom, modelTo, [[], [], '', [], []])], newModelOffset),
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
    const modelFrom = renderService.convertRenderToModelPosition(from);
    const modelTo = renderService.convertRenderToModelPosition(to);
    const nodes = findNodesByComponentIdAndPartId(
        modelService.getRoot(),
        componentId,
        partId,
        modelService.resolvePosition(modelFrom),
        modelService.resolvePosition(modelTo),
    );
    transformService.applyTransformation(
        new Transformation(
            nodes.map((node) => new ApplyAttribute(buildModelPosition(node), attributeKey, attributeValue)),
        ),
    );
};
