import { ModelNode } from '.';
import { Disposable } from '../../event/emitter';
import { Mark } from '../../mark/mark';
import { BaseModelNode, Path, Point } from './base';
import { InlineModelNode } from './inline';

export type BlockModelNodeChild = string | InlineModelNode<any>;

export class BlockModelNode<TAttributes> extends BaseModelNode<TAttributes> {
    readonly type = 'block';

    protected _children: BlockModelNodeChild[];
    protected _marks: Mark[];
    protected childDidUpdateDisposableMap: Map<string, Disposable> = new Map();

    constructor(
        componentId: string,
        id: string,
        attributes: TAttributes,
        marks: Mark[],
        children: BlockModelNodeChild[],
    ) {
        super(componentId, id, attributes);
        this._marks = marks;
        this._children = children;
        for (const child of children) {
            if (typeof child !== 'string') {
                this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate));
            }
        }
        this.assertEndsWithNewline();
    }

    get children(): Readonly<BlockModelNodeChild[]> {
        return this._children;
    }

    get marks(): Readonly<Mark[]> {
        return this._marks;
    }

    get size() {
        return this._children.length;
    }

    setMarks(marks: Mark[]) {
        this._marks = marks;
        this.didUpdateEventEmitter.emit({});
    }

    spliceChildren(start: number, deleteCount: number, children: BlockModelNodeChild[]) {
        if (start < 0 || start > this._children.length || start + deleteCount > this._children.length) {
            throw new Error('Splice is out of range.');
        }
        for (const child of children) {
            if (typeof child === 'string' && child.length !== 1) {
                throw new Error('Block child must be character or inline node.');
            }
        }
        for (let n = 0; n < deleteCount; n++) {
            const child = this._children[start + n];
            if (typeof child !== 'string') {
                this.childDidUpdateDisposableMap.get(child.id)?.dispose();
                this.childDidUpdateDisposableMap.delete(child.id);
            }
        }
        for (const child of children) {
            if (typeof child !== 'string') {
                this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate));
            }
        }
        const removed = this._children.splice(start, deleteCount, ...children);
        this.assertEndsWithNewline();
        this.didUpdateEventEmitter.emit({});
        return removed;
    }

    pointToOffset(point: Point) {
        if (point.path.length > 0 || point.offset < 0 || point.offset >= this._children.length) {
            throw new Error(`Point ${point.path.join(',')}+${point.offset} is invalid.`);
        }
        return point.offset;
    }

    offsetToPoint(offset: number) {
        if (offset < 0 || offset >= this._children.length) {
            throw new Error(`Offset ${offset} is invalid.`);
        }
        return { path: [], offset };
    }

    findByPath(path: Path): ModelNode {
        if (path.length === 0) {
            return this;
        }
        throw new Error('Invalid path.');
    }

    findByPoint(point: Point): string | InlineModelNode<any> {
        if (point.path.length === 0) {
            return this._children[point.offset];
        }
        throw new Error('Invalid point.');
    }

    validateChildren(children: Array<ModelNode | string>) {
        return children.every((child) => typeof child === 'string' || ['inline'].includes(child.type));
    }

    protected assertEndsWithNewline() {
        if (this.children[this.children.length - 1] !== '\n') {
            throw new Error('Block children must end with the newline character.');
        }
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}
