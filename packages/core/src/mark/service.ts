import { ConfigService } from '../config/service';
import { IMarkTypeRegistry, MarkTypeRegistry } from './registry';

export class MarkService {
    protected registry: IMarkTypeRegistry = new MarkTypeRegistry();

    constructor(configService: ConfigService) {
        configService.getConfig().markTypes.forEach((markType) => {
            this.registry.registerMarkType(markType);
        });
    }

    getMarkType<TAttributes>(markTypeId: string) {
        return this.registry.getMarkType<TAttributes>(markTypeId);
    }
}
