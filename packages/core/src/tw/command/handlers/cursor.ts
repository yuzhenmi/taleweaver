import { MoveBy } from '../../cursor/change/moveBy';
import { MoveTo } from '../../cursor/change/moveTo';
import { ILayoutService } from '../../layout/service';
import { Transformation } from '../../transform/transformation';
import { ICommandHandler } from '../command';

function atPreviousLine(offset: number, leftLock: number, layoutService: ILayoutService) {
    const { node: line, offset: lineOffset } = layoutService.resolvePosition(offset).atLineDepth();
    const previousLine = line.previousCrossParentSibling;
    if (!previousLine) {
        return offset - lineOffset;
    }
    return offset - lineOffset - previousLine.size + previousLine.convertCoordinatesToOffset(leftLock, 0);
}

function atNextLine(offset: number, leftLock: number, layoutService: ILayoutService) {
    const { node: line, offset: lineOffset } = layoutService.resolvePosition(offset).atLineDepth();
    const nextLine = line.nextCrossParentSibling;
    if (!nextLine) {
        return offset - lineOffset + line.size - 1;
    }
    return offset - lineOffset + line.size + nextLine.convertCoordinatesToOffset(leftLock, 0);
}

function atPreviousWord(offset: number, layoutService: ILayoutService) {
    const { node: word, offset: wordOffset } = layoutService.resolvePosition(offset).atReverseDepth(0);
    if (wordOffset > 0) {
        return offset - wordOffset;
    }
    const previousWord = word.previousCrossParentSibling;
    if (!previousWord) {
        return offset;
    }
    return offset - previousWord.size;
}

function atNextWord(offset: number, layoutService: ILayoutService) {
    const { node: word, offset: wordOffset } = layoutService.resolvePosition(offset).atReverseDepth(0);
    if (wordOffset < word.size - 1) {
        return offset - wordOffset + word.size - 1;
    }
    const nextWord = word.nextCrossParentSibling;
    if (!nextWord) {
        return offset;
    }
    return offset - wordOffset + word.size + nextWord.size - 1;
}

function atLineStart(offset: number, layoutService: ILayoutService) {
    const { offset: lineOffset } = layoutService.resolvePosition(offset).atLineDepth();
    if (lineOffset === 0) {
        return offset;
    }
    return offset - lineOffset;
}

function atLineEnd(offset: number, layoutService: ILayoutService) {
    const { node: line, offset: lineOffset } = layoutService.resolvePosition(offset).atLineDepth();
    if (lineOffset >= line.size - 1) {
        return offset;
    }
    return offset - lineOffset + line.size - 1;
}

export const move: ICommandHandler = async (serviceRegistry, offset: number) => {
    const transformService = serviceRegistry.getService('transform');
    const renderService = serviceRegistry.getService('render');
    const modelOffset = renderService.convertOffsetToModelOffset(offset);
    transformService.applyTransformation(new Transformation([new MoveTo(modelOffset)]));
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
    const newOffset = atPreviousLine(offset, leftLock, layoutService);
    const renderService = serviceRegistry.getService('render');
    const newModelOffset = renderService.convertOffsetToModelOffset(newOffset);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelOffset)], true));
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
    const newOffset = atNextLine(offset, leftLock, layoutService);
    const renderService = serviceRegistry.getService('render');
    const newModelOffset = renderService.convertOffsetToModelOffset(newOffset);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelOffset)], true));
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
    const newOffset = atPreviousWord(offset, layoutService);
    const renderService = serviceRegistry.getService('render');
    const newModelOffset = renderService.convertOffsetToModelOffset(newOffset);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelOffset)]));
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
    const newOffset = atNextWord(offset, layoutService);
    const renderService = serviceRegistry.getService('render');
    const newModelOffset = renderService.convertOffsetToModelOffset(newOffset);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelOffset)]));
};

export const moveToLineStart: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const offset = Math.min(anchor, head);
    const newOffset = atLineStart(offset, layoutService);
    const renderService = serviceRegistry.getService('render');
    const newModelOffset = renderService.convertOffsetToModelOffset(newOffset);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelOffset)]));
};

export const moveToLineEnd: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const offset = Math.max(anchor, head);
    const newOffset = atLineEnd(offset, layoutService);
    const renderService = serviceRegistry.getService('render');
    const newModelOffset = renderService.convertOffsetToModelOffset(newOffset);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelOffset)]));
};

export const moveToDocStart: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    transformService.applyTransformation(new Transformation([new MoveTo(0)]));
};

export const moveToDocEnd: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const modelService = serviceRegistry.getService('model');
    const newModelOffset = modelService.getRootSize() - 1;
    transformService.applyTransformation(new Transformation([new MoveTo(newModelOffset)]));
};

export const moveHead: ICommandHandler = async (serviceRegistry, offset: number) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const { anchor } = cursorService.getCursor();
    const modelAnchor = renderService.convertOffsetToModelOffset(anchor);
    const newModelHead = renderService.convertOffsetToModelOffset(offset);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelHead, modelAnchor)]));
};

export const moveHeadLeft: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    transformService.applyTransformation(new Transformation([new MoveBy(-1, true)]));
};

export const moveHeadRight: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    transformService.applyTransformation(new Transformation([new MoveBy(1, true)]));
};

export const moveHeadUp: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head, leftLock } = cursorService.getCursor();
    const newHead = atPreviousLine(head, leftLock, layoutService);
    const modelAnchor = renderService.convertOffsetToModelOffset(anchor);
    const newModelHead = renderService.convertOffsetToModelOffset(newHead);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelHead, modelAnchor)], true));
};

export const moveHeadDown: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head, leftLock } = cursorService.getCursor();
    const newHead = atNextLine(head, leftLock, layoutService);
    const modelAnchor = renderService.convertOffsetToModelOffset(anchor);
    const newModelHead = renderService.convertOffsetToModelOffset(newHead);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelHead, modelAnchor)], true));
};

export const moveHeadLeftByWord: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const newHead = atPreviousWord(head, layoutService);
    const modelAnchor = renderService.convertOffsetToModelOffset(anchor);
    const newModelHead = renderService.convertOffsetToModelOffset(newHead);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelHead, modelAnchor)]));
};

export const moveHeadRightByWord: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const newHead = atNextWord(head, layoutService);
    const modelAnchor = renderService.convertOffsetToModelOffset(anchor);
    const newModelHead = renderService.convertOffsetToModelOffset(newHead);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelHead, modelAnchor)]));
};

export const moveHeadToLineStart: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const newHead = atLineStart(head, layoutService);
    const modelAnchor = renderService.convertOffsetToModelOffset(anchor);
    const newModelHead = renderService.convertOffsetToModelOffset(newHead);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelHead, modelAnchor)]));
};

export const moveHeadToLineEnd: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const newHead = atLineEnd(head, layoutService);
    const modelAnchor = renderService.convertOffsetToModelOffset(anchor);
    const newModelHead = renderService.convertOffsetToModelOffset(newHead);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelHead, modelAnchor)]));
};

export const moveHeadToDocStart: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const { anchor } = cursorService.getCursor();
    const modelAnchor = renderService.convertOffsetToModelOffset(anchor);
    transformService.applyTransformation(new Transformation([new MoveTo(0, modelAnchor)]));
};

export const moveHeadToDocEnd: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const { anchor } = cursorService.getCursor();
    const newHead = renderService.getDocSize() - 1;
    const modelAnchor = renderService.convertOffsetToModelOffset(anchor);
    const newModelHead = renderService.convertOffsetToModelOffset(newHead);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelHead, modelAnchor)]));
};

export const selectAll: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const modelService = serviceRegistry.getService('model');
    if (!cursorService.hasCursor()) {
        return;
    }
    transformService.applyTransformation(new Transformation([new MoveTo(modelService.getRootSize() - 1, 0)]));
};

export const selectWord: ICommandHandler = async (serviceRegistry, offset: number) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { node: word, offset: wordOffset } = layoutService.resolvePosition(offset).atReverseDepth(0);
    const newHead = offset - wordOffset + word.size - 1;
    const newAnchor = offset - wordOffset;
    const newModelHead = renderService.convertOffsetToModelOffset(newHead);
    const newModelAnchor = renderService.convertOffsetToModelOffset(newAnchor);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelHead, newModelAnchor)]));
};

export const selectBlock: ICommandHandler = async (serviceRegistry, offset: number) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { node: block, offset: blockOffset } = layoutService.resolvePosition(offset).atBlockDepth();
    const newHead = offset - blockOffset + block.size - 1;
    const newAnchor = offset - blockOffset;
    const newModelHead = renderService.convertOffsetToModelOffset(newHead);
    const newModelAnchor = renderService.convertOffsetToModelOffset(newAnchor);
    transformService.applyTransformation(new Transformation([new MoveTo(newModelHead, newModelAnchor)]));
};
