import { MoveBy } from '../../cursor/change/moveBy';
import { MoveTo } from '../../cursor/change/moveTo';
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
    const to = Math.min(anchor, head);
    transformService.applyTransformation(
        new Transformation([
            new ReplaceChange(
                renderService.convertOffsetToModelOffset(from),
                renderService.convertOffsetToModelOffset(to),
                [new Fragment(content, 0)],
            ),
            new MoveBy(content.length, false),
        ]),
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
    transformService.applyTransformation(
        new Transformation([
            new ReplaceChange(
                renderService.convertOffsetToModelOffset(from),
                renderService.convertOffsetToModelOffset(to),
                [],
            ),
            new MoveTo(from),
        ]),
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
    transformService.applyTransformation(
        new Transformation([
            new ReplaceChange(
                renderService.convertOffsetToModelOffset(from),
                renderService.convertOffsetToModelOffset(to),
                [],
            ),
            new MoveTo(from),
        ]),
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
    transformService.applyTransformation(
        new Transformation([
            new ReplaceChange(
                renderService.convertOffsetToModelOffset(from),
                renderService.convertOffsetToModelOffset(to),
                [new Fragment([], 1)],
            ),
            new MoveTo(from),
        ]),
    );
};
