import { IElement } from 'tw/element/element';

export interface IElementRegistry {
    registerElement(elementId: string, element: IElement): void;
    getElement(elementId: string): IElement | undefined;
}

export class ElementRegistry implements IElementRegistry {
    protected elementsMap: Map<string, IElement> = new Map();

    registerElement(elementId: string, element: IElement) {
        this.elementsMap.set(elementId, element);
    }

    getElement(elementId: string) {
        return this.elementsMap.get(elementId);
    }
}
