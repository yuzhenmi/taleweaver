import { BlockRenderSpec, DocRenderSpec, InlineRenderSpec } from '../render/spec';

export type Component<TAttributes> =
    | DocComponent<TAttributes>
    | BlockComponent<TAttributes>
    | InlineComponent<TAttributes>;

abstract class BaseComponent {
    constructor(readonly id: string) {}
}

export abstract class DocComponent<TAttributes> extends BaseComponent {
    abstract render(attributes: Partial<TAttributes>): DocRenderSpec;

    readonly type = 'doc';
}

export abstract class BlockComponent<TAttributes> extends BaseComponent {
    abstract render(attributes: Partial<TAttributes>): BlockRenderSpec;

    readonly type = 'block';
}

export abstract class InlineComponent<TAttributes> extends BaseComponent {
    abstract render(attributes: Partial<TAttributes>): InlineRenderSpec;

    readonly type = 'inline';
}
