import { IModelNode, IModelPosition } from '../../model/node';
import { identifyModelNodeType } from '../../model/utility';
import { IServiceRegistry } from '../../service/registry';
import { CLOSE_TOKEN, IToken, IOpenToken } from '../../state/token';
import { DeleteOperation, InsertOperation, Transformation, AttributeOperation } from '../../state/transformation';
import { generateId } from '../../util/id';
import { ICommandHandler } from '../command';
import { IParagraphStyle } from '../../component/components/paragraph'
import { identifyTokenType, identifyTokenModelType } from '../../state/utility';

function moveCursorByModelOffset(serviceRegistry: IServiceRegistry, modelOffset: number) {
    const renderService = serviceRegistry.getService('render');
    const offset = renderService.convertModelOffsetToOffset(modelOffset);
    const tn = new Transformation();
    tn.setCursor(offset);
    serviceRegistry.getService('state').applyTransformation(tn);
}

export const alignment: ICommandHandler = async (serviceRegistry, textAlign: IParagraphStyle["textAlign"]) => {
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const modelService = serviceRegistry.getService('model');
    const stateService = serviceRegistry.getService('state');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const { anchor, head } = cursorService.getCursorState();
    let node = modelService.resolvePosition(
        renderService.convertOffsetToModelOffset(Math.min(anchor, head))
    ).getChild()
    if (!node) {
        return;
    }
    let collapsedAt = renderService.convertOffsetToModelOffset(Math.min(anchor, head)) - node.getOffset()
    tn.addOperation(new AttributeOperation(collapsedAt, {
        textAlign,
    }));
    let index = renderService.convertOffsetToModelOffset(Math.min(anchor, head))
    const maxIndex = renderService.convertOffsetToModelOffset(Math.max(anchor, head))
    console.log({
        index,
        maxIndex,
        anchor,
        head
    });
    
    while (index < maxIndex) {
        index += 1;
        const token = stateService.getTokens()[index];
        if (identifyTokenType(token) === "OpenToken") {
            if (identifyTokenModelType(token as IOpenToken) === "Block") {
                tn.addOperation(new AttributeOperation(index, {
                    textAlign,
                }));
            }
        }
    }
    serviceRegistry.getService('state').applyTransformation(tn);
}

export const insert: ICommandHandler = async (serviceRegistry, tokens: IToken[]) => {
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const { anchor, head } = cursorService.getCursorState();
    const collapsedAt = Math.min(anchor, head);
    if (anchor !== head) {
        tn.addOperation(
            new DeleteOperation(
                renderService.convertOffsetToModelOffset(Math.min(anchor, head)),
                renderService.convertOffsetToModelOffset(Math.max(anchor, head)),
            ),
        );
    }
    const modelCollapsedAt = renderService.convertOffsetToModelOffset(collapsedAt);
    tn.addOperation(new InsertOperation(modelCollapsedAt, tokens));
    serviceRegistry.getService('state').applyTransformation(tn);
    moveCursorByModelOffset(serviceRegistry, modelCollapsedAt + tokens.length);
};

export const deleteBackward: ICommandHandler = async serviceRegistry => {
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const { anchor, head } = cursorService.getCursorState();
    let deleteFrom: number;
    let deleteTo: number;
    if (anchor === head) {
        if (head < 1) {
            return;
        }
        deleteFrom = head - 1;
        deleteTo = head;
    } else {
        deleteFrom = Math.min(anchor, head);
        deleteTo = Math.max(anchor, head);
    }
    const modelDeleteFrom = renderService.convertOffsetToModelOffset(deleteFrom);
    const modelDeleteTo = renderService.convertOffsetToModelOffset(deleteTo);
    tn.addOperation(new DeleteOperation(modelDeleteFrom, modelDeleteTo));
    serviceRegistry.getService('state').applyTransformation(tn);
    moveCursorByModelOffset(serviceRegistry, modelDeleteFrom);
};

export const deleteForward: ICommandHandler = async serviceRegistry => {
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const { anchor, head } = cursorService.getCursorState();
    let deleteFrom: number;
    let deleteTo: number;
    if (anchor === head) {
        if (head >= renderService.getDocSize() - 1) {
            return;
        }
        deleteFrom = head;
        deleteTo = head + 1;
    } else {
        deleteFrom = Math.min(anchor, head);
        deleteTo = Math.max(anchor, head);
    }
    const modelDeleteFrom = renderService.convertOffsetToModelOffset(deleteFrom);
    const modelDeleteTo = renderService.convertOffsetToModelOffset(deleteTo);
    tn.addOperation(new DeleteOperation(modelDeleteFrom, modelDeleteTo));
    serviceRegistry.getService('state').applyTransformation(tn);
    moveCursorByModelOffset(serviceRegistry, modelDeleteFrom);
};

export const splitLine: ICommandHandler = async serviceRegistry => {
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const modelService = serviceRegistry.getService('model');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor } = cursorService.getCursorState();
    let position: IModelPosition | null = modelService
        .resolvePosition(renderService.convertOffsetToModelOffset(anchor))
        .getLeaf();
    const nodes: IModelNode[] = [];
    while (position) {
        const node = position.getNode();
        nodes.push(node);
        if (identifyModelNodeType(node) === 'block') {
            break;
        }
        position = position.getParent();
    }
    const tokens: IToken[] = [];
    nodes.reverse().forEach(node => {
        tokens.unshift(CLOSE_TOKEN);
        tokens.push({
            componentId: node.getComponentId(),
            partId: node.getPartId(),
            id: generateId(),
            attributes: node.getAttributes(),
        });
    });
    return insert(serviceRegistry, tokens);
};
