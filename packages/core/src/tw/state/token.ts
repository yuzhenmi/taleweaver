export interface IAttributes {
    [key: string]: any;
}

export interface IOpenToken {
    getElementId(): string;
    getType(): string;
    getId(): string;
    getAttributes(): IAttributes;
}

export interface ICloseToken {}

export type IContentToken = string;

export type IToken = IOpenToken | ICloseToken | IContentToken;

export class OpenToken implements IOpenToken {
    constructor(
        protected elementId: string,
        protected type: string,
        protected id: string,
        protected attributes: IAttributes,
    ) {}

    getElementId() {
        return this.elementId;
    }

    getType() {
        return this.type;
    }

    getId() {
        return this.id;
    }

    getAttributes() {
        return this.attributes;
    }
}

export class CloseToken implements ICloseToken {}
