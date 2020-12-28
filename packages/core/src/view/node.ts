import { IDOMService } from '../dom/service';
import { EventEmitter, IDisposable } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { IBlockLayout } from '../layout/block-node';
import { IDocLayout } from '../layout/doc-node';
import { IInlineLayout } from '../layout/inline-node';
import { ILineLayout } from '../layout/line-node';
import { IPageLayout } from '../layout/page-node';
import { ITextLayout } from '../layout/text-node';
import { generateId } from '../util/id';

export interface IDidUpdateViewNodeEvent {}

interface IBaseViewNode<TLayout> {
    readonly id: string;
    readonly layoutId: string;
    readonly layout: TLayout;
    readonly domContainer: HTMLElement;

    setLayout(layout: TLayout): void;
    onDidUpdate: IOnEvent<IDidUpdateViewNodeEvent>;
}

export type IDocViewNodeChild = IPageViewNode;

export interface IDocViewNode extends IBaseViewNode<IDocLayout> {
    readonly type: 'doc';
    readonly children: IDocViewNodeChild[];

    setChildren(children: IDocViewNodeChild[]): void;
}

export type IPageViewNodeChild = IBlockViewNode;

export interface IPageViewNode extends IBaseViewNode<IPageLayout> {
    readonly type: 'page';
    readonly children: IPageViewNodeChild[];
    readonly domContentContainer: HTMLElement;

    setChildren(children: IPageViewNodeChild[]): void;
}

export type IBlockViewNodeChild = ILineViewNode;

export interface IBlockViewNode extends IBaseViewNode<IBlockLayout> {
    readonly type: 'block';
    readonly children: IBlockViewNodeChild[];

    setChildren(children: IBlockViewNodeChild[]): void;
}

export type ILineViewNodeChild = ITextViewNode | IInlineViewNode;

export interface ILineViewNode extends IBaseViewNode<ILineLayout> {
    readonly type: 'line';
    readonly children: ILineViewNodeChild[];

    setChildren(children: ILineViewNodeChild[]): void;
}

export interface ITextViewNode extends IBaseViewNode<ITextLayout> {
    readonly type: 'text';
    readonly content: string;

    setContent(content: string): void;
}

export interface IInlineViewNode extends IBaseViewNode<IInlineLayout> {
    readonly type: 'inline';
}

export type IViewNode = IDocViewNode | IPageViewNode | IBlockViewNode | ILineViewNode | IInlineViewNode | ITextViewNode;

export type IBoundedViewNode = IPageViewNode | ILineViewNode;

abstract class BaseViewNode<TLayout> implements IBaseViewNode<TLayout> {
    readonly id = generateId();
    abstract readonly domContainer: HTMLElement;

    protected abstract updateDOMLayout(): void;

    protected internalLayout?: TLayout;
    protected didUpdateEventEmitter = new EventEmitter<IDidUpdateViewNodeEvent>();

    constructor(readonly layoutId: string) {}

    get layout() {
        if (!this.internalLayout) {
            throw new Error('Layout is not initialized.');
        }
        return this.internalLayout;
    }

    setLayout(layout: TLayout) {
        this.internalLayout = layout;
        this.updateDOMLayout();
        this.didUpdateEventEmitter.emit({});
    }

    onDidUpdate(listener: IEventListener<IDidUpdateViewNodeEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }
}

export class DocViewNode extends BaseViewNode<IDocLayout> implements IDocViewNode {
    readonly type = 'doc';
    readonly domContainer: HTMLDivElement;
    readonly domContentContainer: HTMLDivElement;

    protected internalChildren: IDocViewNodeChild[] = [];
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(layoutId: string, protected domService: IDOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div', { role: 'doc', className: 'doc--container' });
        this.domContainer.style.display = 'block';
        this.domContainer.style.textAlign = 'left';
        this.domContainer.style.cursor = 'text';
        this.domContainer.style.userSelect = 'none';
        this.domContentContainer = domService.createElement('div', { role: 'doc-content', className: 'doc--content' });
        this.domContentContainer.style.display = 'block';
        this.domContainer.appendChild(this.domContentContainer);
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
            this.domContentContainer,
            children.map((child) => child.domContainer),
        );
        this.didUpdateEventEmitter.emit({});
    }

    protected updateDOMLayout() {}

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class PageViewNode extends BaseViewNode<IPageLayout> implements IPageViewNode {
    readonly type = 'page';
    readonly domContainer: HTMLDivElement;
    readonly domContentContainer: HTMLDivElement;

    protected internalChildren: IPageViewNodeChild[] = [];
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(layoutId: string, protected domService: IDOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div', { role: 'page', className: 'page--container' });
        this.domContainer.style.display = 'block';
        this.domContainer.style.position = 'relative';
        this.domContainer.style.marginLeft = 'auto';
        this.domContainer.style.marginRight = 'auto';
        this.domContainer.style.width = '0px';
        this.domContainer.style.height = '0px';
        this.domContainer.style.paddingTop = '0px';
        this.domContainer.style.paddingBottom = '0px';
        this.domContainer.style.paddingLeft = '0px';
        this.domContainer.style.paddingRight = '0px';
        this.domContentContainer = domService.createElement('div', {
            role: 'page-content',
            className: 'page--content',
        });
        this.domContentContainer.style.display = 'block';
        this.domContainer.appendChild(this.domContentContainer);
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
            this.domContentContainer,
            children.map((child) => child.domContainer),
        );
        this.didUpdateEventEmitter.emit({});
    }

    protected updateDOMLayout() {
        this.domContainer.style.width = `${this.layout.width}px`;
        this.domContainer.style.height = `${this.layout.height}px`;
        this.domContainer.style.paddingTop = `${this.layout.paddingTop}px`;
        this.domContainer.style.paddingBottom = `${this.layout.paddingBottom}px`;
        this.domContainer.style.paddingLeft = `${this.layout.paddingLeft}px`;
        this.domContainer.style.paddingRight = `${this.layout.paddingRight}px`;
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class BlockViewNode extends BaseViewNode<IBlockLayout> implements IBlockViewNode {
    readonly type = 'block';
    readonly domContainer: HTMLDivElement;

    protected internalChildren: IBlockViewNodeChild[] = [];
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(layoutId: string, protected domService: IDOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div', { role: 'block', className: 'block--container' });
        this.domContainer.style.display = 'block';
        this.domContainer.style.width = '0px';
        this.domContainer.style.height = '0px';
        this.domContainer.style.paddingTop = '0px';
        this.domContainer.style.paddingBottom = '0px';
        this.domContainer.style.paddingLeft = '0px';
        this.domContainer.style.paddingRight = '0px';
        this.domContainer.style.lineHeight = '1em';
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

    protected updateDOMLayout() {
        this.domContainer.style.width = `${this.layout.width}px`;
        this.domContainer.style.height = `${this.layout.height}px`;
        this.domContainer.style.paddingTop = `${this.layout.paddingTop}px`;
        this.domContainer.style.paddingBottom = `${this.layout.paddingBottom}px`;
        this.domContainer.style.paddingLeft = `${this.layout.paddingLeft}px`;
        this.domContainer.style.paddingRight = `${this.layout.paddingRight}px`;
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class LineViewNode extends BaseViewNode<ILineLayout> implements ILineViewNode {
    readonly type = 'line';
    readonly domContainer: HTMLDivElement;

    protected internalChildren: ILineViewNodeChild[] = [];
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(layoutId: string, protected domService: IDOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div', { role: 'line', className: 'line--container' });
        this.domContainer.style.display = 'block';
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

    protected updateDOMLayout() {
        this.domContainer.style.width = `${this.layout.width}px`;
        this.domContainer.style.height = `${this.layout.height}px`;
        this.domContainer.style.whiteSpace = 'nowrap';
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class TextViewNode extends BaseViewNode<ITextLayout> implements ITextViewNode {
    readonly type = 'text';
    readonly domContainer: HTMLDivElement;
    readonly domInnerContainer: HTMLDivElement;

    protected internalContent: string = '';

    constructor(layoutId: string, protected domService: IDOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div', { role: 'text', className: 'text--container' });
        this.domContainer.style.display = 'inline-block';
        this.domInnerContainer = domService.createElement('div', { role: 'text-content', className: 'text--content' });
        this.domInnerContainer.style.display = 'inline';
        this.domContainer.appendChild(this.domInnerContainer);
    }

    get content() {
        return this.internalContent;
    }

    setContent(content: string) {
        this.internalContent = content;
        this.domInnerContainer.innerText = content;
        this.didUpdateEventEmitter.emit({});
    }

    protected updateDOMLayout() {
        this.domContainer.style.width = `${this.layout.width}px`;
        this.domContainer.style.height = `${this.layout.height}px`;
        this.domContainer.style.fontFamily = this.layout.family;
        this.domContainer.style.fontSize = `${this.layout.size}px`;
        this.domContainer.style.letterSpacing = `${this.layout.letterSpacing}px`;
        this.domContainer.style.fontWeight = `${this.layout.weight}`;
        this.domContainer.style.color = this.layout.color;
        this.domContainer.style.textDecoration = this.layout.underline ? 'underline' : '';
        this.domContainer.style.fontStyle = this.layout.italic ? 'italic' : '';
        this.domInnerContainer.style.textDecoration = this.layout.strikethrough ? 'line-through' : '';
    }
}

export class InlineViewNode extends BaseViewNode<IInlineLayout> implements IInlineViewNode {
    readonly type = 'inline';
    readonly size = 1;
    readonly domContainer: HTMLDivElement;

    constructor(layoutId: string, protected domService: IDOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div', { role: 'inline', className: 'inline--container' });
        this.domContainer.style.display = 'inline-block';
    }

    protected updateDOMLayout() {
        this.domContainer.style.width = `${this.layout.width}px`;
        this.domContainer.style.height = `${this.layout.height}px`;
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
