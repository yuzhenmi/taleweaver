import { IDOMService } from '../dom/service';
import { EventEmitter, IDisposable } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IBlockStyle, IDocStyle, IInlineStyle, ILineStyle, IPageStyle } from '../layout/node';
import { ITextStyle } from '../text/service';
import { generateId } from '../util/id';

export interface IDidUpdateViewNodeEvent {}

interface IBaseViewNode<TStyle> {
    readonly id: string;
    readonly layoutId: string;
    readonly style: TStyle;
    readonly domContainer: HTMLElement;

    setStyle(style: TStyle): void;
    onDidUpdate: IOnEvent<IDidUpdateViewNodeEvent>;
}

export type IDocViewNodeChild = IPageViewNode;

export interface IDocViewNode extends IBaseViewNode<IDocStyle> {
    readonly type: 'doc';
    readonly children: IDocViewNodeChild[];

    setChildren(children: IDocViewNodeChild[]): void;
}

export type IPageViewNodeChild = IBlockViewNode;

export interface IPageViewNode extends IBaseViewNode<IPageStyle> {
    readonly type: 'page';
    readonly children: IPageViewNodeChild[];
    readonly domContentContainer: HTMLElement;

    setChildren(children: IPageViewNodeChild[]): void;
}

export type IBlockViewNodeChild = ILineViewNode;

export interface IBlockViewNode extends IBaseViewNode<IBlockStyle> {
    readonly type: 'block';
    readonly children: IBlockViewNodeChild[];

    setChildren(children: IBlockViewNodeChild[]): void;
}

export type ILineViewNodeChild = ITextViewNode | IInlineViewNode;

export interface ILineViewNode extends IBaseViewNode<ILineStyle> {
    readonly type: 'line';
    readonly children: ILineViewNodeChild[];

    setChildren(children: ILineViewNodeChild[]): void;
}

export type ITextViewNodeChild = IWordViewNode;

export interface ITextViewNode extends IBaseViewNode<ITextStyle> {
    readonly type: 'text';
    readonly children: ITextViewNodeChild[];

    setChildren(children: ITextViewNodeChild[]): void;
}

export interface IWordViewNode extends IBaseViewNode<ITextStyle> {
    readonly type: 'word';
    readonly content: string;
    readonly whitespaceSize: number;

    setContent(content: string): void;
    setWhitespaceSize(whitespaceSize: number): void;
}

export interface IInlineViewNode extends IBaseViewNode<IInlineStyle> {
    readonly type: 'inline';
}

export type IViewNode =
    | IDocViewNode
    | IPageViewNode
    | IBlockViewNode
    | ILineViewNode
    | IInlineViewNode
    | ITextViewNode
    | IWordViewNode;

export type IBoundedViewNode = IPageViewNode | ILineViewNode;

abstract class BaseViewNode<TStyle> implements IBaseViewNode<TStyle> {
    readonly id = generateId();
    abstract readonly domContainer: HTMLElement;

    protected internalStyle?: TStyle;
    protected didUpdateEventEmitter = new EventEmitter<IDidUpdateViewNodeEvent>();

    constructor(readonly layoutId: string) {}

    get style() {
        if (!this.internalStyle) {
            throw new Error('Style is not initialized.');
        }
        return JSON.parse(JSON.stringify(this.internalStyle));
    }

    setStyle(style: TStyle) {
        this.internalStyle = style;
    }

    onDidUpdate(listener: IEventListener<IDidUpdateViewNodeEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }
}

export class DocViewNode extends BaseViewNode<IDocStyle> implements IDocViewNode {
    readonly type = 'doc';
    readonly domContainer: HTMLDivElement;

    protected internalChildren: IDocViewNodeChild[] = [];
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(layoutId: string, protected domService: IDOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div');
    }

    get children() {
        return this.internalChildren.slice();
    }

    setChildren(children: IDocViewNodeChild[]) {
        this.childDidUpdateDisposableMap.forEach((disposable) => disposable.dispose());
        this.childDidUpdateDisposableMap.clear();
        children.forEach((child) =>
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate)),
        );
        this.internalChildren = children;
        setDOMContainerChildren(
            this.domContainer,
            children.map((child) => child.domContainer),
        );
        this.didUpdateEventEmitter.emit({});
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class PageViewNode extends BaseViewNode<IPageStyle> implements IPageViewNode {
    readonly type = 'page';
    readonly domContainer: HTMLDivElement;
    readonly domContentContainer: HTMLDivElement;

    protected internalChildren: IPageViewNodeChild[] = [];
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(layoutId: string, protected domService: IDOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div');
        this.domContentContainer = domService.createElement('div');
    }

    get children() {
        return this.internalChildren.slice();
    }

    setChildren(children: IPageViewNodeChild[]) {
        this.childDidUpdateDisposableMap.forEach((disposable) => disposable.dispose());
        this.childDidUpdateDisposableMap.clear();
        children.forEach((child) =>
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate)),
        );
        this.internalChildren = children;
        setDOMContainerChildren(
            this.domContainer,
            children.map((child) => child.domContainer),
        );
        this.didUpdateEventEmitter.emit({});
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class BlockViewNode extends BaseViewNode<IBlockStyle> implements IBlockViewNode {
    readonly type = 'block';
    readonly domContainer: HTMLDivElement;

    protected internalChildren: IBlockViewNodeChild[] = [];
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(layoutId: string, protected domService: IDOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div');
    }

    get children() {
        return this.internalChildren.slice();
    }

    setChildren(children: IBlockViewNodeChild[]) {
        this.childDidUpdateDisposableMap.forEach((disposable) => disposable.dispose());
        this.childDidUpdateDisposableMap.clear();
        children.forEach((child) =>
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate)),
        );
        this.internalChildren = children;
        setDOMContainerChildren(
            this.domContainer,
            children.map((child) => child.domContainer),
        );
        this.didUpdateEventEmitter.emit({});
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class LineViewNode extends BaseViewNode<ILineStyle> implements ILineViewNode {
    readonly type = 'line';
    readonly domContainer: HTMLDivElement;

    protected internalChildren: ILineViewNodeChild[] = [];
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(layoutId: string, protected domService: IDOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div');
    }

    get children() {
        return this.internalChildren.slice();
    }

    setChildren(children: ILineViewNodeChild[]) {
        this.childDidUpdateDisposableMap.forEach((disposable) => disposable.dispose());
        this.childDidUpdateDisposableMap.clear();
        children.forEach((child) =>
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate)),
        );
        this.internalChildren = children;
        setDOMContainerChildren(
            this.domContainer,
            children.map((child) => child.domContainer),
        );
        this.didUpdateEventEmitter.emit({});
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class TextViewNode extends BaseViewNode<ITextStyle> implements ITextViewNode {
    readonly type = 'text';
    readonly domContainer: HTMLDivElement;

    protected internalChildren: ITextViewNodeChild[] = [];
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(layoutId: string, protected domService: IDOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div');
    }

    get children() {
        return this.internalChildren.slice();
    }

    setChildren(children: ITextViewNodeChild[]) {
        this.childDidUpdateDisposableMap.forEach((disposable) => disposable.dispose());
        this.childDidUpdateDisposableMap.clear();
        children.forEach((child) =>
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate)),
        );
        this.internalChildren = children;
        setDOMContainerChildren(
            this.domContainer,
            children.map((child) => child.domContainer),
        );
        this.didUpdateEventEmitter.emit({});
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class WordViewNode extends BaseViewNode<ITextStyle> implements IWordViewNode {
    readonly type = 'word';
    readonly domContainer: HTMLDivElement;

    protected internalContent: string = '';
    protected internalWhitespaceSize: number = 0;

    constructor(layoutId: string, protected domService: IDOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div');
    }

    get content() {
        return this.internalContent;
    }

    get whitespaceSize() {
        return this.internalWhitespaceSize;
    }

    setContent(content: string) {
        this.internalContent = content;
        this.domContainer.innerText = content;
    }

    setWhitespaceSize(whitespaceSize: number) {
        this.internalWhitespaceSize = whitespaceSize;
    }
}

export class InlineViewNode extends BaseViewNode<IInlineStyle> implements IInlineViewNode {
    readonly type = 'inline';
    readonly size = 1;
    readonly domContainer: HTMLDivElement;

    constructor(layoutId: string, protected domService: IDOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div');
    }
}

function setDOMContainerChildren(domContainer: HTMLElement, children: HTMLElement[]) {
    while (domContainer.lastChild) {
        domContainer.removeChild(domContainer.lastChild);
    }
    for (const child of children) {
        domContainer.appendChild(child);
    }
}
