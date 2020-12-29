import { EventEmitter, IDisposable } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IMark } from '../mark/mark';
import { IPath, IPoint } from './position';

export type ISerializableValue =
    | number
    | string
    | boolean
    | ISerializableValue[]
    | { [key: string]: ISerializableValue }
    | null
    | undefined;

export type IAttributes = { [key: string]: ISerializableValue };

export interface IDidUpdateModelNodeEvent {}

interface IBaseModelNode {
    readonly componentId: string;
    readonly id: string;
    readonly attributes: IAttributes;
    readonly contentSize: number;
    readonly needRender: boolean;

    setAttribute(key: string, value: ISerializableValue): void;
    markAsRendered(): void;
    toContentPosition(position: IPoint): number;
    fromContentPosition(contentPosition: number): IPoint;
    onDidUpdate: IOnEvent<IDidUpdateModelNodeEvent>;
}

export type IDocModelNodeChild = IBlockModelNode;

export interface IDocModelNode extends IBaseModelNode {
    readonly type: 'doc';
    readonly children: IDocModelNodeChild[];

    insertChild(child: IDocModelNodeChild, at: number): void;
    removeChild(child: IDocModelNodeChild): void;
    findByPath(path: IPath): IModelNode;
}

export type IContent = Array<string | IInlineModelNode>;

export interface IBlockModelNode extends IBaseModelNode {
    readonly type: 'block';
    readonly content: IContent;
    readonly marks: IMark[];

    appendMark(mark: IMark): void;
    insertContent(content: IContent, at: number): void;
    removeContent(at: number, length: number): IContent;
}

export interface IInlineModelNode extends IBaseModelNode {
    readonly type: 'inline';
    readonly contentSize: 1;
}

export type IModelNode = IDocModelNode | IBlockModelNode | IInlineModelNode;

abstract class BaseModelNode implements IBaseModelNode {
    abstract readonly contentSize: number;

    abstract toContentPosition(position: IPoint): number;
    abstract fromContentPosition(contentPosition: number): IPoint;

    protected internalAttributes: IAttributes = {};
    protected internalNeedRender = true;
    protected didUpdateEventEmitter = new EventEmitter<IDidUpdateModelNodeEvent>();

    constructor(readonly componentId: string, readonly id: string) {
        this.onDidUpdate(() => {
            this.internalNeedRender = true;
        });
    }

    get attributes() {
        return JSON.parse(JSON.stringify(this.internalAttributes));
    }

    get needRender() {
        return this.internalNeedRender;
    }

    setAttribute(key: string, value: ISerializableValue) {
        this.internalAttributes[key] = value;
        this.didUpdateEventEmitter.emit({});
    }

    markAsRendered() {
        this.internalNeedRender = false;
    }

    onDidUpdate(listener: IEventListener<IDidUpdateModelNodeEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }
}

export class DocModelNode extends BaseModelNode implements IDocModelNode {
    readonly type = 'doc';

    protected internalChildren: IDocModelNodeChild[] = [];
    protected internalContentSize?: number;
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(componentId: string, id: string) {
        super(componentId, id);
        this.onDidUpdate(() => {
            this.internalContentSize = undefined;
        });
    }

    get children() {
        return this.internalChildren.slice();
    }

    get contentSize() {
        if (this.internalContentSize === undefined) {
            this.internalContentSize = this.calculateContentSize();
        }
        return this.internalContentSize;
    }

    insertChild(child: IDocModelNodeChild, at: number) {
        if (at < 0 || at > this.internalChildren.length) {
            throw new Error('Child insertion point is out of range.');
        }
        this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate));
        this.internalChildren.splice(at, 0, child);
        this.didUpdateEventEmitter.emit({});
    }

    removeChild(child: IDocModelNodeChild) {
        const index = this.internalChildren.indexOf(child);
        if (index < 0) {
            throw new Error('Child not found.');
        }
        this.childDidUpdateDisposableMap.get(child.id)?.dispose();
        this.childDidUpdateDisposableMap.delete(child.id);
        this.internalChildren.splice(index, 1);
        this.didUpdateEventEmitter.emit({});
    }

    findByPath(path: IPath): IModelNode {
        if (path.length === 0) {
            return this;
        }
        const childOffset = path[0];
        if (childOffset < 0 || childOffset >= this.internalChildren.length) {
            throw new Error('Path is out of bound.');
        }
        const child = this.internalChildren[childOffset];
        switch (child.type) {
            case 'block': {
                return child;
            }
            default: {
                throw new Error('Path is invalid.');
            }
        }
    }

    toContentPosition(position: IPoint) {
        const currentOffset = position.path[0];
        if (currentOffset < 0 || currentOffset >= this.internalChildren.length) {
            throw new Error('Position is invalid.');
        }
        const child = this.internalChildren[currentOffset];
        const childPath = position.path.slice(1);
        return (
            this.internalChildren
                .slice(0, currentOffset)
                .reduce((contentSize, child) => contentSize + child.contentSize, 0) +
            child.toContentPosition({
                path: childPath,
                offset: position.offset,
            })
        );
    }

    fromContentPosition(contentPosition: number) {
        let cumulatedContentSize = 0;
        for (let n = 0, nn = this.internalChildren.length; n < nn; n++) {
            const child = this.internalChildren[n];
            const childContentSize = child.contentSize;
            if (contentPosition < cumulatedContentSize + childContentSize) {
                const childPosition = child.fromContentPosition(contentPosition - cumulatedContentSize);
                return {
                    path: [n, ...childPosition.path],
                    offset: childPosition.offset,
                };
            }
            cumulatedContentSize += child.contentSize;
        }
        throw new Error(`Content position ${contentPosition} is not valid.`);
    }

    protected calculateContentSize() {
        return this.internalChildren.reduce((contentSize, child) => contentSize + child.contentSize, 0);
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class BlockModelNode extends BaseModelNode implements IBlockModelNode {
    readonly type = 'block';

    protected internalContent: IContent = ['\n'];
    protected internalMarks: IMark[] = [];
    protected internalContentSize?: number;
    protected inlineDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    get content() {
        return this.internalContent.slice();
    }

    get marks(): IMark[] {
        return JSON.parse(JSON.stringify(this.internalMarks));
    }

    get contentSize() {
        return this.internalContent.length;
    }

    appendMark(mark: IMark) {
        this.internalMarks.push(mark);
        this.didUpdateEventEmitter.emit({});
    }

    insertContent(content: IContent, at: number) {
        if (at < 0 || at >= this.internalContent.length) {
            throw new Error('Content insertion point is out of range.');
        }
        content.forEach((characterOrInlineNode) => {
            if (typeof characterOrInlineNode !== 'string') {
                this.inlineDidUpdateDisposableMap.set(
                    characterOrInlineNode.id,
                    characterOrInlineNode.onDidUpdate(this.handleInlineDidUpdate),
                );
            }
        });
        this.internalContent.splice(at, 0, ...content);
        this.didUpdateEventEmitter.emit({});
    }

    removeContent(at: number, length: number) {
        if (at < 0 || at >= this.internalContent.length - 1) {
            throw new Error('Content removal point is out of range.');
        }
        if (length <= 0) {
            throw new Error('Content removal length must be positive.');
        }
        if (at + length >= this.internalContent.length) {
            throw new Error('Content removal length is out of range.');
        }
        const removedContent = this.internalContent.splice(at, length);
        this.didUpdateEventEmitter.emit({});
        return removedContent;
    }

    toContentPosition(position: IPoint) {
        if (position.path.length > 0 || position.offset < 0 || position.offset >= this.internalContent.length) {
            throw new Error('Position is invalid.');
        }
        return position.offset;
    }

    fromContentPosition(contentPosition: number) {
        if (contentPosition < 0 || contentPosition >= this.internalContent.length) {
            throw new Error('Content position is invalid.');
        }
        return { path: [], offset: contentPosition };
    }

    protected handleInlineDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class InlineModelNode extends BaseModelNode implements IInlineModelNode {
    readonly type = 'inline';
    readonly contentSize = 1;

    toContentPosition(position: IPoint) {
        if (position.path.length > 0 || position.offset !== 0) {
            throw new Error('Position is invalid.');
        }
        return position.offset;
    }

    fromContentPosition(contentPosition: number) {
        if (contentPosition !== 0) {
            throw new Error('Content position is invalid.');
        }
        return { path: [], offset: contentPosition };
    }
}
