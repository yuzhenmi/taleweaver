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
        return offset + wordOffset - 1;
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
    const newOffset = atPreviousLine(offset, leftLock, layoutService);
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset, newOffset)], true));
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
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset, newOffset)], true));
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
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset, newOffset)]));
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
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset, newOffset)]));
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
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset, newOffset)]));
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
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset, newOffset)]));
};

export const moveToDocStart: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    transformService.applyTransformation(new Transformation([new MoveTo(0, 0)]));
};

export const moveToDocEnd: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const renderService = serviceRegistry.getService('render');
    const newOffset = renderService.getDocSize() - 1;
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset, newOffset)]));
};

export const moveHead: ICommandHandler = async (serviceRegistry, offset: number) => {
    const transformService = serviceRegistry.getService('transform');
    transformService.applyTransformation(new Transformation([new MoveTo(offset)]));
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
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head, leftLock } = cursorService.getCursor();
    const offset = Math.min(anchor, head);
    const newOffset = atPreviousLine(offset, leftLock, layoutService);
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset)], true));
};

export const moveHeadDown: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head, leftLock } = cursorService.getCursor();
    const offset = Math.max(anchor, head);
    const newOffset = atNextLine(offset, leftLock, layoutService);
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset)], true));
};

export const moveHeadLeftByWord: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const offset = Math.min(anchor, head);
    const newOffset = atPreviousWord(offset, layoutService);
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset)]));
};

export const moveHeadRightByWord: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const offset = Math.max(anchor, head);
    const newOffset = atNextWord(offset, layoutService);
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset)]));
};

export const moveHeadToLineStart: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const offset = Math.min(anchor, head);
    const newOffset = atLineStart(offset, layoutService);
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset)]));
};

export const moveHeadToLineEnd: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const offset = Math.max(anchor, head);
    const newOffset = atLineEnd(offset, layoutService);
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset)]));
};

export const moveHeadToDocStart: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    transformService.applyTransformation(new Transformation([new MoveTo(0)]));
};

export const moveHeadToDocEnd: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const renderService = serviceRegistry.getService('render');
    const newOffset = renderService.getDocSize() - 1;
    transformService.applyTransformation(new Transformation([new MoveTo(newOffset)]));
};

export const selectAll: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    transformService.applyTransformation(new Transformation([new MoveTo(renderService.getDocSize() - 1, 0)]));
};

export const selectWord: ICommandHandler = async (serviceRegistry, offset: number) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { node: word, offset: wordOffset } = layoutService.resolvePosition(offset).atReverseDepth(0);
    transformService.applyTransformation(
        new Transformation([new MoveTo(offset - wordOffset + word.size - 1, offset - wordOffset)]),
    );
};

export const selectBlock: ICommandHandler = async (serviceRegistry, offset: number) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { node: block, offset: blockOffset } = layoutService.resolvePosition(offset).atBlockDepth();
    transformService.applyTransformation(
        new Transformation([new MoveTo(offset - blockOffset + block.size - 1, offset - blockOffset)]),
    );
};
