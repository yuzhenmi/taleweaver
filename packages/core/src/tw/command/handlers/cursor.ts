import { MoveBy } from '../../cursor/change/moveBy';
import { MoveTo } from '../../cursor/change/moveTo';
import { ILayoutLine } from '../../layout/line';
import { IRenderPosition } from '../../render/node';
import { IAtomicRenderNode } from '../../render/text';
import { identifyRenderNodeType } from '../../render/utility';
import { Transformation } from '../../transform/transformation';
import { ICommandHandler } from '../command';

export const move: ICommandHandler = async (serviceRegistry, offset: number) => {
    const transformService = serviceRegistry.getService('transform');
    transformService.applyTransformation(new Transformation([new MoveTo(offset, offset)]));
};

export const moveLeft: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    transformService.applyTransformation(new Transformation([new MoveBy(-1, false)]));
};

export const moveRight: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    transformService.applyTransformation(new Transformation([new MoveBy(1, false)]));
};

export const moveUp: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head, leftLock } = cursorService.getCursor();
    const offset = Math.min(anchor, head);
    const position = layoutService.resolvePosition(offset);
    const { node: line, offset: lineOffset } = position.atLineDepth();
    const previousLine = line.previousCrossParentSibling;
    let newOffset: number;
    if (!previousLine) {
        newOffset = offset - lineOffset;
    } else {
        newOffset = offset - lineOffset - previousLine.size + previousLine.convertCoordinatesToOffset(leftLock, 0);
    }
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset)], true));
};

export const moveDown: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head, leftLock } = cursorService.getCursor();
    const offset = Math.max(anchor, head);
    const position = layoutService.resolvePosition(offset);
    const { node: line, offset: lineOffset } = position.atLineDepth();
    const nextLine = line.nextCrossParentSibling;
    let newOffset: number;
    if (!nextLine) {
        newOffset = offset - lineOffset + line.size - 1;
    } else {
        newOffset = offset - lineOffset + line.size + nextLine.convertCoordinatesToOffset(leftLock, 0);
    }
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset)]));
};

export const moveLeftByWord: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const offset = Math.min(anchor, head);
    const { node: word, offset: wordOffset } = layoutService.resolvePosition(offset).atReverseDepth(0);
    let newOffset: number;
    if (wordOffset > 0) {
        newOffset = offset - wordOffset;
    } else {
        const previousWord = word.previousCrossParentSibling;
        if (!previousWord) {
            return;
        }
        newOffset = offset - previousWord.size;
    }
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset)]));
};

export const moveRightByWord: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const offset = Math.max(anchor, head);
    const { node: word, offset: wordOffset } = layoutService.resolvePosition(offset).atReverseDepth(0);
    let newOffset: number;
    if (wordOffset < word.size - 1) {
        newOffset = offset + wordOffset - 1;
    } else {
        const nextWord = word.nextCrossParentSibling;
        if (!nextWord) {
            return;
        }
        newOffset = offset - wordOffset + word.size + nextWord.size - 1;
    }
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset)]));
};

export const moveToLineStart: ICommandHandler = async (serviceRegistry) => {
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const offset = Math.min(cursorState.anchor, cursorState.head);
    const position = layoutService.resolvePosition(offset);
    const lineBoxLevelPosition = position.getLeaf().getParent()!.getParent()!;
    if (lineBoxLevelPosition.getOffset() > 0) {
        tn.setCursor(offset - lineBoxLevelPosition.getOffset());
    } else {
        tn.setCursor(offset);
    }
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveToLineEnd: ICommandHandler = async (serviceRegistry) => {
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const offset = Math.max(cursorState.anchor, cursorState.head);
    const position = layoutService.resolvePosition(offset);
    const lineLayoutPosition = position.getLeaf().getParent()!.getParent()!;
    const lineLayoutNode = lineLayoutPosition.getNode();
    if (identifyLayoutNodeType(lineLayoutNode) !== 'Line') {
        throw new Error(`Expecting position to be referencing an line layout node.`);
    }
    if (lineLayoutPosition.getOffset() < lineLayoutNode.getSize() - 1) {
        tn.setCursor(offset - lineLayoutPosition.getOffset() + lineLayoutNode.getSize() - 1);
    } else {
        tn.setCursor(offset);
    }
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveToDocStart: ICommandHandler = async (serviceRegistry) => {
    const cursorService = serviceRegistry.getService('cursor');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    tn.setCursor(0);
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveToDocEnd: ICommandHandler = async (serviceRegistry) => {
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const docSize = renderService.getDocSize();
    tn.setCursor(docSize - 1);
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveHead: ICommandHandler = async (serviceRegistry, offset: number) => {
    const tn = new Transformation();
    tn.setCursorHead(offset);
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveHeadLeft: ICommandHandler = async (serviceRegistry) => {
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

export const moveHeadRight: ICommandHandler = async (serviceRegistry) => {
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

export const moveHeadUp: ICommandHandler = async (serviceRegistry) => {
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const position = layoutService.resolvePosition(cursorState.head);
    const linePosition = position.getLeaf().getParent()!.getParent()!;
    const lineNode = linePosition.getNode() as ILayoutLine;
    if (identifyLayoutNodeType(lineNode) !== 'Line') {
        throw new Error(`Expecting position to be referencing an line node.`);
    }
    const previousLineNode = lineNode.getPreviousSiblingAllowCrossParent() as ILayoutLine;
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

export const moveHeadDown: ICommandHandler = async (serviceRegistry) => {
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const offset = cursorState.head;
    const position = layoutService.resolvePosition(offset);
    const linePosition = position.getLeaf().getParent()!.getParent()!;
    const lineNode = linePosition.getNode() as ILayoutLine;
    if (identifyLayoutNodeType(lineNode) !== 'Line') {
        throw new Error(`Expecting position to be referencing an line node.`);
    }
    const nextLineNode = lineNode.getNextSiblingAllowCrossParent() as ILayoutLine;
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

export const moveHeadLeftByWord: ICommandHandler = async (serviceRegistry) => {
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const offset = cursorState.head;
    const position = renderService.resolvePosition(offset);
    const atomicPosition = position.getLeaf();
    const atomicNode = atomicPosition.getNode();
    if (identifyRenderNodeType(atomicNode) !== 'atomic') {
        throw new Error(`Expecting position to be referencing an atomic node.`);
    }
    if (atomicPosition.getOffset() > 0) {
        tn.setCursorHead(offset - atomicPosition.getOffset());
    } else {
        const previousAtomicNode = atomicNode.getPreviousSiblingAllowCrossParent() as IAtomicRenderNode;
        if (previousAtomicNode) {
            tn.setCursorHead(offset - previousAtomicNode.getSize());
        }
    }
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveHeadRightByWord: ICommandHandler = async (serviceRegistry) => {
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const offset = cursorState.head;
    const position = renderService.resolvePosition(offset);
    const atomicPosition = position.getLeaf();
    const atomicNode = atomicPosition.getNode();
    if (identifyRenderNodeType(atomicNode) !== 'atomic') {
        throw new Error(`Expecting position to be referencing an atomic node.`);
    }
    if (atomicPosition.getOffset() < atomicNode.getSize() - 1) {
        tn.setCursorHead(offset - atomicPosition.getOffset() + atomicNode.getSize() - 1);
    } else {
        const nextAtomicNode = atomicNode.getNextSiblingAllowCrossParent() as IAtomicRenderNode;
        if (nextAtomicNode) {
            let newCursorPosition =
                offset - atomicPosition.getOffset() + atomicNode.getSize() + nextAtomicNode.getSize();
            if (nextAtomicNode.isBreakable()) {
                newCursorPosition--;
            }
            tn.setCursorHead(newCursorPosition);
        }
    }
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveHeadToLineStart: ICommandHandler = async (serviceRegistry) => {
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const offset = cursorState.head;
    const position = layoutService.resolvePosition(offset);
    const lineLayoutPosition = position.getLeaf().getParent()!.getParent()!;
    if (lineLayoutPosition.getOffset() > 0) {
        tn.setCursorHead(offset - lineLayoutPosition.getOffset());
    } else {
        tn.setCursorHead(offset);
    }
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveHeadToLineEnd: ICommandHandler = async (serviceRegistry) => {
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const cursorState = cursorService.getCursorState();
    const offset = cursorState.head;
    const position = layoutService.resolvePosition(offset);
    const lineLayoutPosition = position.getLeaf().getParent()!.getParent()!;
    const lineLayoutNode = lineLayoutPosition.getNode();
    if (identifyLayoutNodeType(lineLayoutNode) !== 'Line') {
        throw new Error(`Expecting position to be referencing an line layout node.`);
    }
    if (lineLayoutPosition.getOffset() < lineLayoutNode.getSize() - 1) {
        tn.setCursorHead(offset - lineLayoutPosition.getOffset() + lineLayoutNode.getSize() - 1);
    } else {
        tn.setCursorHead(offset);
    }
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveHeadToDocStart: ICommandHandler = async (serviceRegistry) => {
    const cursorService = serviceRegistry.getService('cursor');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    tn.setCursorHead(0);
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const moveHeadToDocEnd: ICommandHandler = async (serviceRegistry) => {
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const docSize = renderService.getDocSize();
    tn.setCursorHead(docSize - 1);
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const selectAll: ICommandHandler = async (serviceRegistry) => {
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

export const selectWord: ICommandHandler = async (serviceRegistry, offset: number) => {
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const position = renderService.resolvePosition(offset);
    const atomicPosition = position.getLeaf();
    const atomicNode = atomicPosition.getNode() as IAtomicRenderNode;
    tn.setCursor(offset - atomicPosition.getOffset());
    tn.setCursorHead(
        offset -
            atomicPosition.getOffset() +
            (atomicNode.isBreakable() ? atomicNode.getSize() - 1 : atomicNode.getSize()),
    );
    serviceRegistry.getService('state').applyTransformation(tn);
};

export const selectBlock: ICommandHandler = async (serviceRegistry, offset: number) => {
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const tn = new Transformation();
    const position = renderService.resolvePosition(offset);
    const atomicPosition = position.getLeaf();
    const blockPosition = searchBlockRenderPositionBottomUp(atomicPosition);
    if (!blockPosition) {
        return;
    }
    const blockNode = blockPosition.getNode();
    tn.setCursor(offset - blockPosition.getOffset());
    tn.setCursorHead(offset - blockPosition.getOffset() + blockNode.getSize() - 1);
    serviceRegistry.getService('state').applyTransformation(tn);
};

function searchBlockRenderPositionBottomUp(position: IRenderPosition): IRenderPosition | null {
    if (identifyRenderNodeType(position.getNode()) === 'block') {
        return position;
    }
    const parent = position.getParent();
    if (!parent) {
        return null;
    }
    return searchBlockRenderPositionBottomUp(parent);
}
