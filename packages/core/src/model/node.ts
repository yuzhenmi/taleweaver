import { Disposable, EventEmitter } from '../event/emitter';
import { EventListener } from '../event/listener';
import { Mark } from '../mark/mark';
import { Path } from './path';

export interface DidUpdateModelNodeEvent {}

type Children = Array<string | ModelNode<unknown>>;

interface ModelNodeOptions<TProps> {
    componentId: string;
    id: string;
    props: TProps;
    marks: Mark[];
    children: Children;
}

/**
 * A node in a tree.
 * @typeParam TProps The type of the props.
 */
export class ModelNode<TProps> {
    readonly componentId: string;
    readonly id: string;

    protected _props: TProps;
    protected _marks: Mark[];
    protected _children: Children;
    protected _needRender = true;

    protected didUpdateEventEmitter = new EventEmitter<DidUpdateModelNodeEvent>();
    protected childDidUpdateDisposableMap: Map<string, Disposable> = new Map();

    constructor({ componentId, id, props, marks, children }: ModelNodeOptions<TProps>) {
        this.componentId = componentId;
        this.id = id;
        this._props = props;
        this._marks = marks;
        this._children = children;

        this.onDidUpdate(() => {
            this._needRender = true;
        });

        for (const child of children) {
            if (typeof child !== 'string') {
                this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate));
            }
        }
    }

    setProps(props: TProps) {
        this._props = props;
        this.didUpdateEventEmitter.emit({});
    }

    get props(): Readonly<TProps> {
        return this._props;
    }

    setMarks(marks: Mark[]) {
        this._marks = marks;
        this.didUpdateEventEmitter.emit({});
    }

    get marks(): Readonly<Mark[]> {
        return this._marks;
    }

    spliceChildren(start: number, deleteCount: number, children: Children) {
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
        this.didUpdateEventEmitter.emit({});
        return removed;
    }

    get children(): Readonly<Children> {
        return this._children;
    }

    markAsRendered() {
        this._needRender = false;
    }

    get needRender() {
        return this._needRender;
    }

    findNodeByPath(path: Path): ModelNode<unknown> {
        if (path.length === 0) {
            return this;
        }
        const child = this._children[path[0]];
        if (typeof child === 'string') {
            throw new Error('Path is out of range.');
        }
        return child.findNodeByPath(path.slice(1));
    }

    onDidUpdate(listener: EventListener<DidUpdateModelNodeEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}
