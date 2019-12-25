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
    const offset = Math.min(cursorState.anchor, cursorState.head);
    const position = layoutService.resolvePosition(offset);
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
        tn.setCursor(offset - linePosition.getOffset());
    } else {
        let leftLock = cursorState.leftLock;
        if (leftLock === null) {
            leftLock = lineNode.resolveRects(linePosition.getOffset(), linePosition.getOffset())[0].left;
        }
        tn.setCursorLockLeft(leftLock);
        const targetLineSelectableOffset = previousLineNode.convertCoordinateToOffset(leftLock);
        tn.setCursor(offset - linePosition.getOffset() - previousLineNode.getSize() + targetLineSelectableOffset);
    }
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveDown: ICommandHandler = async serviceRegistry => {
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const offset = Math.max(cursorState.anchor, cursorState.head);
    const position = layoutService.resolvePosition(offset);
    const linePosition = position
        .getLeaf()
        .getParent()!
        .getParent()!;
    const lineNode = linePosition.getNode() as ILineLayoutNode;
    if (identifyLayoutNodeType(lineNode) !== 'Line') {
        throw new Error(`Expecting position to be referencing an line node.`);
    }
    const nextLineNode = lineNode.getNextSiblingAllowCrossParent() as ILineLayoutNode;
    if (!nextLineNode) {
        tn.setCursor(offset - linePosition.getOffset() + lineNode.getSize() - 1);
    } else {
        let leftLock = cursorState.leftLock;
        if (leftLock === null) {
            leftLock = lineNode.resolveRects(linePosition.getOffset(), linePosition.getOffset())[0].left;
        }
        tn.setCursorLockLeft(leftLock);
        const targetLineSelectableOffset = nextLineNode.convertCoordinateToOffset(leftLock);
        tn.setCursor(offset - linePosition.getOffset() + lineNode.getSize() + targetLineSelectableOffset);
    }
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveLeft: ICommandHandler = async serviceRegistry => {
    const cursorService = serviceRegistry.getService('cursor');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const anchor = cursorState.anchor;
    const head = cursorState.head;
    if (anchor === head) {
        if (head < 1) {
            return;
        }
        tn.setCursor(head - 1);
    } else {
        if (anchor < head) {
            tn.setCursor(anchor);
        } else if (anchor > head) {
            tn.setCursor(head);
        }
    }
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveRight: ICommandHandler = async serviceRegistry => {
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const anchor = cursorState.anchor;
    const head = cursorState.head;
    const docSize = renderService.getDocSize();
    if (anchor === head) {
        if (head >= docSize - 1) {
            return;
        }
        tn.setCursor(head + 1);
    } else {
        if (anchor < head) {
            tn.setCursor(head);
        } else if (anchor > head) {
            tn.setCursor(anchor);
        }
    }
    serviceRegistry.getService('state').applyTransformation(tn);
};

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

export const moveHeadDown: ICommandHandler = async serviceRegistry => {
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const offset = cursorState.head;
    const position = layoutService.resolvePosition(offset);
    const linePosition = position
        .getLeaf()
        .getParent()!
        .getParent()!;
    const lineNode = linePosition.getNode() as ILineLayoutNode;
    if (identifyLayoutNodeType(lineNode) !== 'Line') {
        throw new Error(`Expecting position to be referencing an line node.`);
    }
    const nextLineNode = lineNode.getNextSiblingAllowCrossParent() as ILineLayoutNode;
    if (!nextLineNode) {
        tn.setCursorHead(offset - linePosition.getOffset() + lineNode.getSize() - 1);
    } else {
        let leftLock = cursorState.leftLock;
        if (leftLock === null) {
            leftLock = lineNode.resolveRects(linePosition.getOffset(), linePosition.getOffset())[0].left;
        }
        tn.setCursorLockLeft(leftLock);
        const targetLineSelectableOffset = nextLineNode.convertCoordinateToOffset(leftLock);
        tn.setCursorHead(offset - linePosition.getOffset() + lineNode.getSize() + targetLineSelectableOffset);
    }
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveHeadLeft: ICommandHandler = async serviceRegistry => {
    const cursorService = serviceRegistry.getService('cursor');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const head = cursorState.head;
    if (head < 1) {
        return;
    }
    tn.setCursorHead(head - 1);
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveHeadRight: ICommandHandler = async serviceRegistry => {
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const head = cursorState.head;
    const docSize = renderService.getDocSize();
    if (head >= docSize - 1) {
        return;
    }
    tn.setCursorHead(head + 1);
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveHeadLeftByWord: ICommandHandler = async serviceRegistry => {};
export const moveHeadRightByWord: ICommandHandler = async serviceRegistry => {};
export const moveHeadToLineLeft: ICommandHandler = async serviceRegistry => {};
export const moveHeadToLineRight: ICommandHandler = async serviceRegistry => {};
export const moveHeadToDocStart: ICommandHandler = async serviceRegistry => {};
export const moveHeadToDocEnd: ICommandHandler = async serviceRegistry => {};

export const selectAll: ICommandHandler = async serviceRegistry => {
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const docSize = renderService.getDocSize();
    tn.setCursor(0);
    tn.setCursorHead(docSize - 1);
    serviceRegistry.getService('state').applyTransformation(tn);
};
