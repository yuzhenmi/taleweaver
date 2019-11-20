import { IConfigService } from 'tw/config/service';
import { IElement } from 'tw/element/element';
import { ElementRegistry, IElementRegistry } from 'tw/element/registry';
import { IService } from 'tw/service/service';

export interface IElementService extends IService {
    getElement(elementId: string): IElement | undefined;
}

export class ElementService implements IElementService {
    protected registry: IElementRegistry = new ElementRegistry();

    constructor(configService: IConfigService) {
        configService.getConfig().elements.forEach((element, elementId) => {
            this.registry.registerElement(elementId, element);
        });
    }

    getElement(elementId: string) {
        return this.registry.getElement(elementId);
    }
}
