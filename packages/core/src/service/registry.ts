import { CommandService } from '../command/service';
import { ComponentService } from '../component/service';
import { ConfigService } from '../config/service';
import { CursorService } from '../cursor/service';
import { DOMService } from '../dom/service';
import { HistoryService } from '../history/service';
import { KeyBindingService } from '../key-binding/service';
import { LayoutService } from '../layout/service';
import { MarkService } from '../mark/service';
import { ModelService } from '../model/service';
import { RenderService } from '../render/service';
import { TextService } from '../text/service';
import { TransformService } from '../transform/service';
import { IViewService } from '../view/service';

export interface Services {
    readonly command: CommandService;
    readonly component: ComponentService;
    readonly config: ConfigService;
    readonly cursor: CursorService;
    readonly dom: DOMService;
    readonly history: HistoryService;
    readonly keyBinding: KeyBindingService;
    readonly layout: LayoutService;
    readonly mark: MarkService;
    readonly model: ModelService;
    readonly render: RenderService;
    readonly text: TextService;
    readonly transform: TransformService;
    readonly view: IViewService;
}

export class ServiceRegistry {
    protected services: Partial<Services> = {};

    registerService<TKey extends keyof Services>(key: TKey, service: Services[TKey]) {
        this.services[key] = service;
    }

    getService<TKey extends keyof Services>(key: TKey) {
        const service = this.services[key];
        if (!service) {
            throw new Error(`Service ${key} is not registered.`);
        }
        return service as Services[TKey];
    }
}
