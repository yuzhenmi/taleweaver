import { EventEmitter, IDisposable } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { ITextStyle } from '../text/service';
import { generateId } from '../util/id';

export interface IDidUpdateRenderNodeEvent {}

interface IBaseRenderNode<TStyle> {
    readonly id: string;
    readonly style: TStyle;
    readonly size: number;
    readonly needLayout: boolean;

    setStyle(style: TStyle): void;
    markAsLaidOut(): void;
    onDidUpdate: IOnEvent<IDidUpdateRenderNodeEvent>;
}

export interface IDocStyle {
    readonly pageWidth: number;
    readonly pageHeight: number;
    readonly pagePaddingTop: number;
    readonly pagePaddingBottom: number;
    readonly pagePaddingLeft: number;
    readonly pagePaddingRight: number;
}

export type IDocRenderNodeChild = IBlockRenderNode;

export interface IDocRenderNode extends IBaseRenderNode<IDocStyle> {
    readonly type: 'doc';
    readonly modelId: string;
    readonly children: IDocRenderNodeChild[];

    setChildren(children: IDocRenderNodeChild[]): void;
}

export interface IBlockStyle {
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
    readonly lineHeight: number;
}

export type IBlockRenderNodeChild = ITextRenderNode | IInlineRenderNode;

export interface IBlockRenderNode extends IBaseRenderNode<IBlockStyle> {
    readonly type: 'block';
    readonly modelId: string;
    readonly children: IBlockRenderNodeChild[];

    setChildren(children: IBlockRenderNodeChild[]): void;
}

export interface ITextRenderNode extends IBaseRenderNode<ITextStyle> {
    readonly type: 'text';
    readonly content: string;

    setContent(content: string): void;
}

export interface IInlineStyle {
    readonly width: number;
    readonly height: number;
}

export interface IInlineRenderNode extends IBaseRenderNode<IInlineStyle> {
    readonly type: 'inline';
    readonly modelId: string;
}

export type IRenderNode = IDocRenderNode | IBlockRenderNode | ITextRenderNode | IInlineRenderNode;

abstract class BaseRenderNode<TStyle> implements IBaseRenderNode<TStyle> {
    abstract readonly size: number;

    readonly id = generateId();

    protected internalStyle?: TStyle;
    protected internalNeedLayout = true;
    protected didUpdateEventEmitter = new EventEmitter<IDidUpdateRenderNodeEvent>();

    constructor() {
        this.onDidUpdate(() => {
            this.internalNeedLayout = true;
        });
    }

    get style() {
        if (!this.internalStyle) {
            throw new Error('Style is not initialized.');
        }
        return this.internalStyle;
    }

    get needLayout() {
        return this.internalNeedLayout;
    }

    setStyle(style: TStyle) {
        this.internalStyle = style;
        this.didUpdateEventEmitter.emit({});
    }

    markAsLaidOut() {
        this.internalNeedLayout = false;
    }

    onDidUpdate(listener: IEventListener<IDidUpdateRenderNodeEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }
}

export class DocRenderNode extends BaseRenderNode<IDocStyle> implements IDocRenderNode {
    readonly type = 'doc';

    protected internalChildren: IDocRenderNodeChild[] = [];
    protected internalSize?: number;
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(readonly modelId: string) {
        super();
        this.onDidUpdate(() => {
            this.internalSize = undefined;
        });
    }

    get children() {
        return this.internalChildren.slice();
    }

    get size() {
        if (this.internalSize === undefined) {
            this.internalSize = this.calculateSize();
        }
        return this.internalSize;
    }

    setChildren(children: IDocRenderNodeChild[]) {
        this.childDidUpdateDisposableMap.forEach((disposable) => disposable.dispose());
        this.childDidUpdateDisposableMap.clear();
        children.forEach((child) =>
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate)),
        );
        this.internalChildren = children;
        this.didUpdateEventEmitter.emit({});
    }

    protected calculateSize() {
        return this.internalChildren.reduce((size, child) => size + child.size, 0);
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class BlockRenderNode extends BaseRenderNode<IBlockStyle> implements IBlockRenderNode {
    readonly type = 'block';

    protected internalChildren: IBlockRenderNodeChild[] = [];
    protected internalSize?: number;
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(readonly modelId: string) {
        super();
        this.onDidUpdate(() => {
            this.internalSize = undefined;
        });
    }

    get children() {
        return this.internalChildren.slice();
    }

    get size() {
        if (this.internalSize === undefined) {
            this.internalSize = this.calculateSize();
        }
        return this.internalSize;
    }

    setChildren(children: IBlockRenderNodeChild[]) {
        this.childDidUpdateDisposableMap.forEach((disposable) => disposable.dispose());
        this.childDidUpdateDisposableMap.clear();
        children.forEach((child) =>
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate)),
        );
        this.internalChildren = children;
        this.didUpdateEventEmitter.emit({});
    }

    protected calculateSize() {
        return this.internalChildren.reduce((size, child) => size + child.size, 0);
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class TextRenderNode extends BaseRenderNode<ITextStyle> implements ITextRenderNode {
    readonly type = 'text';

    protected internalContent = '';

    get content() {
        return this.internalContent;
    }

    get size() {
        return this.internalContent.length;
    }

    setContent(content: string) {
        this.internalContent = content;
        this.didUpdateEventEmitter.emit({});
    }
}

export class InlineRenderNode extends BaseRenderNode<IInlineStyle> implements IInlineRenderNode {
    readonly type = 'inline';
    readonly size = 1;

    constructor(readonly modelId: string) {
        super();
    }
}
