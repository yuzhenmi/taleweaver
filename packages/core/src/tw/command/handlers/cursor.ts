import { ILineLayoutNode } from '../../layout/line-node';
import { identifyLayoutNodeType } from '../../layout/utility';
import { Transformation } from '../../state/transformation';
import { ICommandHandler } from '../command';

export const move: ICommandHandler = async (serviceRegistry, offset: number) => {
    const tn = new Transformation();
    tn.setCursor(offset);
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveUp: ICommandHandler = async serviceRegistry => {
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const position = layoutService.resolvePosition(cursorState.head);
    const linePosition = position
        .getLeaf()
        .getParent()!
        .getParent()!;
    const lineNode = linePosition.getNode() as ILineLayoutNode;
    if (identifyLayoutNodeType(lineNode) !== 'Line') {
        throw new Error(`Expecting position to be referencing an line node.`);
    }
    const previousLineNode = lineNode.getPreviousSiblingAllowCrossParent() as ILineLayoutNode;
    if (!previousLineNode) {
        tn.setCursor(cursorState.head - linePosition.getOffset());
    } else {
        let leftLock = cursorState.leftLock;
        if (leftLock === null) {
            leftLock = lineNode.resolveRects(linePosition.getOffset(), linePosition.getOffset())[0].left;
        }
        tn.setCursorLockLeft(leftLock);
        const targetLineSelectableOffset = previousLineNode.convertCoordinateToOffset(leftLock);
        tn.setCursor(
            cursorState.head - linePosition.getOffset() - previousLineNode.getSize() + targetLineSelectableOffset,
        );
    }
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveDown: ICommandHandler = async serviceRegistry => {};
export const moveLeft: ICommandHandler = async (serviceRegistry, offset: number) => {};
export const moveRight: ICommandHandler = async serviceRegistry => {};
export const moveLeftByWord: ICommandHandler = async serviceRegistry => {};
export const moveRightByWord: ICommandHandler = async serviceRegistry => {};
export const moveToLineLeft: ICommandHandler = async serviceRegistry => {};
export const moveToLineRight: ICommandHandler = async serviceRegistry => {};
export const moveToDocStart: ICommandHandler = async serviceRegistry => {};
export const moveToDocEnd: ICommandHandler = async serviceRegistry => {};

export const moveHead: ICommandHandler = async (serviceRegistry, offset: number) => {
    const tn = new Transformation();
    tn.setCursorHead(offset);
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveHeadUp: ICommandHandler = async serviceRegistry => {
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const position = layoutService.resolvePosition(cursorState.head);
    const linePosition = position
        .getLeaf()
        .getParent()!
        .getParent()!;
    const lineNode = linePosition.getNode() as ILineLayoutNode;
    if (identifyLayoutNodeType(lineNode) !== 'Line') {
        throw new Error(`Expecting position to be referencing an line node.`);
    }
    const previousLineNode = lineNode.getPreviousSiblingAllowCrossParent() as ILineLayoutNode;
    if (!previousLineNode) {
        tn.setCursorHead(cursorState.head - linePosition.getOffset());
    } else {
        let leftLock = cursorState.leftLock;
        if (leftLock === null) {
            leftLock = lineNode.resolveRects(linePosition.getOffset(), linePosition.getOffset())[0].left;
        }
        tn.setCursorLockLeft(leftLock);
        const targetLineSelectableOffset = previousLineNode.convertCoordinateToOffset(leftLock);
        tn.setCursorHead(
            cursorState.head - linePosition.getOffset() - previousLineNode.getSize() + targetLineSelectableOffset,
        );
    }
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveHeadDown: ICommandHandler = async serviceRegistry => {};
export const moveHeadLeft: ICommandHandler = async serviceRegistry => {};
export const moveHeadRight: ICommandHandler = async serviceRegistry => {};
export const moveHeadLeftByWord: ICommandHandler = async serviceRegistry => {};
export const moveHeadRightByWord: ICommandHandler = async serviceRegistry => {};
export const moveHeadToLineLeft: ICommandHandler = async serviceRegistry => {};
export const moveHeadToLineRight: ICommandHandler = async serviceRegistry => {};
export const moveHeadToDocStart: ICommandHandler = async serviceRegistry => {};
export const moveHeadToDocEnd: ICommandHandler = async serviceRegistry => {};
export const selectAll: ICommandHandler = async serviceRegistry => {};
