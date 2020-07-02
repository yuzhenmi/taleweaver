import { atBlock, atLine, atWord } from '../../layout/position';
import { ILayoutService } from '../../layout/service';
import { ILayoutWord } from '../../layout/word';
import { IModelPosition } from '../../model/position';
import { IRenderPosition } from '../../render/position';
import { Transformation } from '../../transform/transformation';
import { ICommandHandler } from '../command';

function atPreviousLine(position: IRenderPosition, leftLock: number, layoutService: ILayoutService) {
    const { node: line, position: linePosition } = atLine(layoutService.resolvePosition(position));
    const previousLine = line.previousCrossParentSibling;
    if (!previousLine) {
        return position - linePosition;
    }
    return position - linePosition - previousLine.size + previousLine.convertCoordinatesToPosition(leftLock, 0);
}

function atNextLine(position: IRenderPosition, leftLock: number, layoutService: ILayoutService) {
    const { node: line, position: linePosition } = atLine(layoutService.resolvePosition(position));
    const nextLine = line.nextCrossParentSibling;
    if (!nextLine) {
        return position - linePosition + line.size - 1;
    }
    return position - linePosition + line.size + nextLine.convertCoordinatesToPosition(leftLock, 0);
}

function atPreviousWord(position: IRenderPosition, layoutService: ILayoutService) {
    const { node: word, offset: wordPosition } = atWord(layoutService.resolvePosition(position));
    if (wordPosition > 0) {
        return position - wordPosition;
    }
    const previousWord = word.previousCrossParentSibling as ILayoutWord | undefined;
    if (!previousWord) {
        return position;
    }
    return position - previousWord.size;
}

function atNextWord(position: IRenderPosition, layoutService: ILayoutService) {
    const { node: word, offset: wordPosition } = atWord(layoutService.resolvePosition(position));
    if (wordPosition < word.size - 1) {
        return position - wordPosition + word.size - (word as ILayoutWord).whitespaceSize;
    }
    const nextWord = word.nextCrossParentSibling;
    if (!nextWord) {
        return position;
    }
    return position - wordPosition + word.size + nextWord.size - (nextWord as ILayoutWord).whitespaceSize;
}

function atLineStart(position: IRenderPosition, layoutService: ILayoutService) {
    const { position: linePosition } = atLine(layoutService.resolvePosition(position));
    if (linePosition === 0) {
        return position;
    }
    return position - linePosition;
}

function atLineEnd(position: IRenderPosition, layoutService: ILayoutService) {
    const { node: line, position: linePosition } = atLine(layoutService.resolvePosition(position));
    if (linePosition >= line.size - 1) {
        return position;
    }
    return position - linePosition + line.size - 1;
}

export const move: ICommandHandler = async (serviceRegistry, position: IRenderPosition) => {
    const transformService = serviceRegistry.getService('transform');
    const renderService = serviceRegistry.getService('render');
    const modelOffset = renderService.convertRenderToModelPosition(position);
    transformService.applyTransformation(new Transformation([], modelOffset));
};

export const moveBackward: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const { anchor, head } = cursorService.getCursor();
    let newModelPosition: IModelPosition;
    if (anchor === head) {
        newModelPosition = renderService.convertRenderToModelPosition(anchor - 1);
    } else {
        const newPosition = Math.min(anchor, head);
        newModelPosition = renderService.convertRenderToModelPosition(newPosition);
    }
    transformService.applyTransformation(new Transformation([], newModelPosition));
};

export const moveForward: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const { anchor, head } = cursorService.getCursor();
    let newModelPosition: IModelPosition;
    if (anchor === head) {
        newModelPosition = renderService.convertRenderToModelPosition(anchor + 1);
    } else {
        const newPosition = Math.max(anchor, head);
        newModelPosition = renderService.convertRenderToModelPosition(newPosition);
    }
    transformService.applyTransformation(new Transformation([], newModelPosition));
};

export const moveBackwardByLine: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head, leftLock } = cursorService.getCursor();
    const position = Math.min(anchor, head);
    const newPosition = atPreviousLine(position, leftLock, layoutService);
    const renderService = serviceRegistry.getService('render');
    const newModelPosition = renderService.convertRenderToModelPosition(newPosition);
    transformService.applyTransformation(new Transformation([], newModelPosition, newModelPosition, true));
};

export const moveForwardByLine: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head, leftLock } = cursorService.getCursor();
    const position = Math.max(anchor, head);
    const newPosition = atNextLine(position, leftLock, layoutService);
    const renderService = serviceRegistry.getService('render');
    const newModelPosition = renderService.convertRenderToModelPosition(newPosition);
    transformService.applyTransformation(new Transformation([], newModelPosition, newModelPosition, true));
};

export const moveBackwardByWord: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const position = Math.min(anchor, head);
    const newPosition = atPreviousWord(position, layoutService);
    const renderService = serviceRegistry.getService('render');
    const newModelPosition = renderService.convertRenderToModelPosition(newPosition);
    transformService.applyTransformation(new Transformation([], newModelPosition));
};

export const moveForwardByWord: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const position = Math.max(anchor, head);
    const newPosition = atNextWord(position, layoutService);
    const renderService = serviceRegistry.getService('render');
    const newModelPosition = renderService.convertRenderToModelPosition(newPosition);
    transformService.applyTransformation(new Transformation([], newModelPosition));
};

export const moveToLineStart: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const position = Math.min(anchor, head);
    const newPosition = atLineStart(position, layoutService);
    const renderService = serviceRegistry.getService('render');
    const newModelPosition = renderService.convertRenderToModelPosition(newPosition);
    transformService.applyTransformation(new Transformation([], newModelPosition));
};

export const moveToLineEnd: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const position = Math.max(anchor, head);
    const newPosition = atLineEnd(position, layoutService);
    const renderService = serviceRegistry.getService('render');
    const newModelPosition = renderService.convertRenderToModelPosition(newPosition);
    transformService.applyTransformation(new Transformation([], newModelPosition));
};

export const moveToDocStart: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const renderService = serviceRegistry.getService('render');
    const newPosition = 0;
    const newModelPosition = renderService.convertRenderToModelPosition(newPosition);
    transformService.applyTransformation(new Transformation([], newModelPosition));
};

export const moveToDocEnd: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const renderService = serviceRegistry.getService('render');
    const newPosition = renderService.getDocSize() - 1;
    const newModelPosition = renderService.convertRenderToModelPosition(newPosition);
    transformService.applyTransformation(new Transformation([], newModelPosition));
};

export const moveHead: ICommandHandler = async (serviceRegistry, position: IRenderPosition) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const { anchor } = cursorService.getCursor();
    const modelAnchor = renderService.convertRenderToModelPosition(anchor);
    const newModelHead = renderService.convertRenderToModelPosition(position);
    transformService.applyTransformation(new Transformation([], newModelHead, modelAnchor));
};

export const moveHeadBackward: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const { anchor, head } = cursorService.getCursor();
    const modelAnchor = renderService.convertRenderToModelPosition(anchor);
    const newModelHead = renderService.convertRenderToModelPosition(head - 1);
    transformService.applyTransformation(new Transformation([], newModelHead, modelAnchor));
};

export const moveHeadForward: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const { anchor, head } = cursorService.getCursor();
    const modelAnchor = renderService.convertRenderToModelPosition(anchor);
    const newModelHead = renderService.convertRenderToModelPosition(head + 1);
    transformService.applyTransformation(new Transformation([], newModelHead, modelAnchor));
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
    const modelAnchor = renderService.convertRenderToModelPosition(anchor);
    const newModelHead = renderService.convertRenderToModelPosition(newHead);
    transformService.applyTransformation(new Transformation([], newModelHead, modelAnchor));
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
    const modelAnchor = renderService.convertRenderToModelPosition(anchor);
    const newModelHead = renderService.convertRenderToModelPosition(newHead);
    transformService.applyTransformation(new Transformation([], newModelHead, modelAnchor));
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
    const modelAnchor = renderService.convertRenderToModelPosition(anchor);
    const newModelHead = renderService.convertRenderToModelPosition(newHead);
    transformService.applyTransformation(new Transformation([], newModelHead, modelAnchor));
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
    const modelAnchor = renderService.convertRenderToModelPosition(anchor);
    const newModelHead = renderService.convertRenderToModelPosition(newHead);
    transformService.applyTransformation(new Transformation([], newModelHead, modelAnchor));
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
    const modelAnchor = renderService.convertRenderToModelPosition(anchor);
    const newModelHead = renderService.convertRenderToModelPosition(newHead);
    transformService.applyTransformation(new Transformation([], newModelHead, modelAnchor));
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
    const modelAnchor = renderService.convertRenderToModelPosition(anchor);
    const newModelHead = renderService.convertRenderToModelPosition(newHead);
    transformService.applyTransformation(new Transformation([], newModelHead, modelAnchor));
};

export const moveHeadToDocStart: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const { anchor } = cursorService.getCursor();
    const newHead = 0;
    const modelAnchor = renderService.convertRenderToModelPosition(anchor);
    const newModelHead = renderService.convertRenderToModelPosition(newHead);
    transformService.applyTransformation(new Transformation([], newModelHead, modelAnchor));
};

export const moveHeadToDocEnd: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const { anchor } = cursorService.getCursor();
    const newHead = renderService.getDocSize() - 1;
    const modelAnchor = renderService.convertRenderToModelPosition(anchor);
    const newModelHead = renderService.convertRenderToModelPosition(newHead);
    transformService.applyTransformation(new Transformation([], newModelHead, modelAnchor));
};

export const selectAll: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const newAnchor = 0;
    const newHead = renderService.getDocSize() - 1;
    const newModelAnchor = renderService.convertRenderToModelPosition(newAnchor);
    const newModelHead = renderService.convertRenderToModelPosition(newHead);
    transformService.applyTransformation(new Transformation([], newModelHead, newModelAnchor));
};

export const selectWord: ICommandHandler = async (serviceRegistry, position: IRenderPosition) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    let { node: word, position: wordPosition } = atWord(layoutService.resolvePosition(position));
    if (word.size - (word as ILayoutWord).whitespaceSize === 0) {
        const previousWord = word.previousCrossParentSibling;
        if (!previousWord) {
            return;
        }
        word = previousWord;
        wordPosition += word.size;
    }
    const newHead = position - wordPosition + word.size - (word as ILayoutWord).whitespaceSize;
    const newAnchor = position - wordPosition;
    const newModelHead = renderService.convertRenderToModelPosition(newHead);
    const newModelAnchor = renderService.convertRenderToModelPosition(newAnchor);
    transformService.applyTransformation(new Transformation([], newModelHead, newModelAnchor));
};

export const selectBlock: ICommandHandler = async (serviceRegistry, position: IRenderPosition) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const layoutService = serviceRegistry.getService('layout');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { node: block, position: blockPosition } = atBlock(layoutService.resolvePosition(position));
    const newHead = position - blockPosition + block.size - 1;
    const newAnchor = position - blockPosition;
    const newModelHead = renderService.convertRenderToModelPosition(newHead);
    const newModelAnchor = renderService.convertRenderToModelPosition(newAnchor);
    transformService.applyTransformation(new Transformation([], newModelHead, newModelAnchor));
};
