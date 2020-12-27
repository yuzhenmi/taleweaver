import {
    IBlockRenderSpec,
    IDocRenderSpec,
    IInlineRenderSpec,
} from '../render/spec';

interface IBaseComponent {
    readonly id: string;
}

export interface IDocComponent<TAttributes> extends IBaseComponent {
    readonly type: 'doc';
    render(attributes: Partial<TAttributes>): IDocRenderSpec;
}

export interface IBlockComponent<TAttributes> extends IBaseComponent {
    readonly type: 'block';
    render(attributes: Partial<TAttributes>): IBlockRenderSpec;
}

export interface IInlineComponent<TAttributes> extends IBaseComponent {
    readonly type: 'inline';
    render(attributes: Partial<TAttributes>): IInlineRenderSpec;
}

export type IComponent<TAttributes> =
    | IDocComponent<TAttributes>
    | IBlockComponent<TAttributes>
    | IInlineComponent<TAttributes>;

abstract class BaseComponent implements IBaseComponent {
    constructor(readonly id: string) {}
}

export abstract class DocComponent<TAttributes> extends BaseComponent
    implements IDocComponent<TAttributes> {
    abstract render(attributes: Partial<TAttributes>): IDocRenderSpec;

    readonly type = 'doc';
}

export abstract class BlockComponent<TAttributes> extends BaseComponent
    implements IBlockComponent<TAttributes> {
    abstract render(attributes: Partial<TAttributes>): IBlockRenderSpec;

    readonly type = 'block';
}

export abstract class InlineComponent<TAttributes> extends BaseComponent
    implements IInlineComponent<TAttributes> {
    abstract render(attributes: Partial<TAttributes>): IInlineRenderSpec;

    readonly type = 'inline';
}
