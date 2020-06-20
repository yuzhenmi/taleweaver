import { MoveBy } from '../../cursor/change/moveBy';
import { MoveTo } from '../../cursor/change/moveTo';
import { ReplaceChange } from '../../model/change/replace';
import { Fragment } from '../../model/fragment';
import { IChange } from '../../transform/change';
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
    const changes: IChange[] = [new ReplaceChange(modelFrom, modelTo, [new Fragment(content, 0)]), new MoveTo(modelTo)];
    if (modelFrom === modelTo) {
        changes.push(new MoveBy(1, false));
    }
    transformService.applyTransformation(new Transformation(changes));
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
    transformService.applyTransformation(
        new Transformation([new ReplaceChange(modelFrom, modelTo, []), new MoveTo(modelFrom)]),
    );
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
    transformService.applyTransformation(
        new Transformation([new ReplaceChange(modelFrom, modelTo, []), new MoveTo(modelTo)]),
    );
};

export const splitLine: ICommandHandler = async (serviceRegistry) => {
    const transformService = serviceRegistry.getService('transform');
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    const from = Math.min(anchor, head);
    const to = Math.min(anchor, head);
    const modelFrom = renderService.convertOffsetToModelOffset(from);
    const modelTo = renderService.convertOffsetToModelOffset(to);
    transformService.applyTransformation(
        new Transformation([new ReplaceChange(modelFrom, modelTo, [new Fragment([], 1)]), new MoveTo(modelTo)]),
    );
};
