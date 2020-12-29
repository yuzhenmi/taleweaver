import { IConfigService } from '../config/service';
import { IMarkType } from './mark';
import { IMarkTypeRegistry, MarkTypeRegistry } from './registry';

export interface IMarkService {
    getMarkType<TAttributes>(markTypeId: string): IMarkType<TAttributes>;
}

export class MarkService implements IMarkService {
    protected registry: IMarkTypeRegistry = new MarkTypeRegistry();

    constructor(configService: IConfigService) {
        configService.getConfig().markTypes.forEach((markType) => {
            this.registry.registerMarkType(markType);
        });
    }

    getMarkType<TAttributes>(markTypeId: string) {
        return this.registry.getMarkType<TAttributes>(markTypeId);
    }
}
