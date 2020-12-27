import { IBlockStyle, IDocStyle, IInlineStyle } from './node';

export interface IDocRenderSpec {
    style: IDocStyle;
}

export interface IBlockRenderSpec {
    style: IBlockStyle;
}

export interface IInlineRenderSpec {
    style: IInlineStyle;
}
