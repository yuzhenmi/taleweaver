import { ReplaceChange } from '../../model/change/replace';
import { Fragment } from '../../model/fragment';
import { Transformation } from '../../transform/transformation';
import { ICommandHandler } from '../command';

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
    const modelFrom = renderService.convertOffsetToModelOffset(from);
    const modelTo = renderService.convertOffsetToModelOffset(to);
    const newModelOffset = modelFrom + content.length;
    transformService.applyTransformation(
        new Transformation([new ReplaceChange(modelFrom, modelTo, [new Fragment(content, 0)])], newModelOffset),
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
    const modelFrom = renderService.convertOffsetToModelOffset(from);
    const modelTo = renderService.convertOffsetToModelOffset(to);
    transformService.applyTransformation(new Transformation([new ReplaceChange(modelFrom, modelTo, [])], modelFrom));
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
    const modelFrom = renderService.convertOffsetToModelOffset(from);
    const modelTo = renderService.convertOffsetToModelOffset(to);
    transformService.applyTransformation(new Transformation([new ReplaceChange(modelFrom, modelTo, [])], modelFrom));
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
    const modelFrom = renderService.convertOffsetToModelOffset(from);
    const modelTo = renderService.convertOffsetToModelOffset(to);
    const newModelOffset = modelFrom + 4;
    transformService.applyTransformation(
        new Transformation([new ReplaceChange(modelFrom, modelTo, [new Fragment([], 2)])], newModelOffset),
    );
};
