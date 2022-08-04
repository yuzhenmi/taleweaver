import { ModelNode } from '.';
import { Disposable } from '../../event/emitter';
import { BaseModelNode, Path, Point } from './base';
import { BlockModelNode } from './block';
import { InlineModelNode } from './inline';

export type DocModelChildNode = BlockModelNode<any>;

export class DocModelNode<TAttributes> extends BaseModelNode<TAttributes> {
    readonly type = 'doc';

    protected _children: DocModelChildNode[];
    protected _size?: number;
    protected childDidUpdateDisposableMap = new Map<string, Disposable>();

    constructor(componentId: string, id: string, attributes: TAttributes, children: DocModelChildNode[]) {
        super(componentId, id, attributes);
        this._children = children;
        for (const child of children) {
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate));
        }
        this.onDidUpdate(() => {
            this._size = undefined;
        });
    }

    get children(): Readonly<DocModelChildNode[]> {
        return this._children;
    }

    get size() {
        if (this._size === undefined) {
            this._size = this._children.reduce((size, child) => size + child.size, 0);
        }
        return this._size;
    }

    spliceChildren(start: number, deleteCount: number, children: DocModelChildNode[]) {
        if (start < 0 || start > this._children.length || start + deleteCount > this._children.length) {
            throw new Error('Splice is out of range.');
        }
        for (let n = 0; n < deleteCount; n++) {
            const childId = this._children[start + n].id;
            this.childDidUpdateDisposableMap.get(childId)?.dispose();
            this.childDidUpdateDisposableMap.delete(childId);
        }
        for (const child of children) {
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate));
        }
        const removed = this._children.splice(start, deleteCount, ...children);
        this.didUpdateEventEmitter.emit({});
        return removed;
    }

    pointToOffset(point: Point) {
        const index = point.path[0];
        if (index < 0 || index >= this._children.length) {
            throw new Error(`Point ${point.path.join(',')}+${point.offset} is invalid.`);
        }
        let offset = 0;
        for (let n = 0; n < index; n++) {
            const child = this._children[n];
            offset += child.size;
        }
        offset += this._children[index].pointToOffset({ path: point.path.slice(1), offset: point.offset });
        return offset;
    }

    offsetToPoint(offset: number) {
        let cumulatedOffset = 0;
        for (let n = 0, nn = this._children.length; n < nn; n++) {
            const child = this._children[n];
            if (cumulatedOffset + child.size > offset) {
                const childPoint = child.offsetToPoint(offset - cumulatedOffset);
                return {
                    path: [n, ...childPoint.path],
                    offset: childPoint.offset,
                };
            }
            cumulatedOffset += child.size;
        }
        throw new Error(`Offset ${offset} is not valid.`);
    }

    findByPath(path: Path): ModelNode {
        if (path.length === 0) {
            return this;
        }
        const child = this._children[path[0]];
        return child.findByPath(path.slice(1));
    }

    findByPoint(point: Point): string | InlineModelNode<any> {
        if (point.path.length === 0) {
            throw new Error('Invalid point.');
        }
        const child = this._children[point.path[0]];
        return child.findByPoint({ path: point.path.slice(1), offset: point.offset });
    }

    validateChildren(children: Array<ModelNode | string>) {
        return children.every((child) => typeof child !== 'string' && ['block'].includes(child.type));
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}
