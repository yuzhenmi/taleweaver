export interface IAttributes {
    [key: string]: any;
}

export interface IOpenToken {
    readonly componentId: string;
    readonly partId?: string;
    readonly id: string;
    readonly attributes: IAttributes;
}

export interface ICloseToken {}

export type IContentToken = string;

export type IToken = IOpenToken | ICloseToken | IContentToken;

export const CLOSE_TOKEN: ICloseToken = {};
