import { MoveBy } from '../../cursor/change/moveBy';
import { MoveTo } from '../../cursor/change/moveTo';
import { ILayoutService } from '../../layout/service';
import { ILayoutWord } from '../../layout/word';
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
    const previousWord = word.previousCrossParentSibling as ILayoutWord | undefined;
    if (!previousWord) {
        return offset;
    }
    return offset - previousWord.size;
}

function atNextWord(offset: number, layoutService: ILayoutService) {
    const { node: word, offset: wordOffset } = layoutService.resolvePosition(offset).atReverseDepth(0);
    if (wordOffset < word.size - 1) {
        return offset - wordOffset + word.size - (word as ILayoutWord).whitespaceSize;
    }
    const nextWord = word.nextCrossParentSibling;
    if (!nextWord) {
        return offset;
    }
    return offset - wordOffset + word.size + nextWord.size - (nextWord as ILayoutWord).whitespaceSize;
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

export const moveBackward: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const { anchor, head } = cursorService.getCursor();
    if (anchor === head) {
        transformService.applyTransformation(new Transformation([new MoveBy(-1, false)]));
    } else {
        const newOffset = Math.min(anchor, head);
        const newModelOffset = renderService.convertOffsetToModelOffset(newOffset);
        transformService.applyTransformation(new Transformation([new MoveTo(newModelOffset)]));
    }
};

export const moveForward: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const { anchor, head } = cursorService.getCursor();
    if (anchor === head) {
        transformService.applyTransformation(new Transformation([new MoveBy(1, false)]));
    } else {
        const newOffset = Math.max(anchor, head);
        const newModelOffset = renderService.convertOffsetToModelOffset(newOffset);
        transformService.applyTransformation(new Transformation([new MoveTo(newModelOffset)]));
    }
};

export const moveBackwardByLine: ICommandHandler = async (serviceRegistry) => {
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

export const moveForwardByLine: ICommandHandler = async (serviceRegistry) => {
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

export const moveBackwardByWord: ICommandHandler = async (serviceRegistry) => {
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

export const moveForwardByWord: ICommandHandler = async (serviceRegistry) => {
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
    const renderService = serviceRegistry.getService('render');
    const newOffset = renderService.getDocSize() - 1;
    const newModelOffset = renderService.convertOffsetToModelOffset(newOffset);
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

export const moveHeadBackward: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    transformService.applyTransformation(new Transformation([new MoveBy(-1, true)]));
};

export const moveHeadForward: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    transformService.applyTransformation(new Transformation([new MoveBy(1, true)]));
};

export const moveHeadBackwardByLine: ICommandHandler = async (serviceRegistry) => {
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

export const moveHeadForwardByLine: ICommandHandler = async (serviceRegistry) => {
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

export const moveHeadBackwardByWord: ICommandHandler = async (serviceRegistry) => {
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

export const moveHeadForwardByWord: ICommandHandler = async (serviceRegistry) => {
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
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const from = 0;
    const to = renderService.getDocSize() - 1;
    const modelFrom = renderService.convertOffsetToModelOffset(from);
    const modelTo = renderService.convertOffsetToModelOffset(to);
    transformService.applyTransformation(new Transformation([new MoveTo(modelFrom, modelTo)]));
};

export const selectWord: ICommandHandler = async (serviceRegistry, offset: number) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    let { node: word, offset: wordOffset } = layoutService.resolvePosition(offset).atReverseDepth(0);
    if (word.size - (word as ILayoutWord).whitespaceSize === 0) {
        const previousWord = word.previousCrossParentSibling;
        if (!previousWord) {
            return;
        }
        word = previousWord;
        wordOffset += word.size;
    }
    const newHead = offset - wordOffset + word.size - (word as ILayoutWord).whitespaceSize;
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
