import { ICommandService } from '../command/service';
import { IComponentService } from '../component/service';
import { IConfigService } from '../config/service';
import { ICursorService } from '../cursor/service';
import { IDOMService } from '../dom/service';
import { IHistoryService } from '../history/service';
import { IKeyBindingService } from '../key-binding/service';
import { ILayoutService } from '../layout/service';
import { IModelService } from '../model/service';
import { IRenderService } from '../render/service';
import { ITextService } from '../text/service';
import { ITransformService } from '../transform/service';
import { IViewService } from '../view/service';

export interface IServices {
    readonly config: IConfigService;
    readonly dom: IDOMService;
    readonly text: ITextService;
    readonly command: ICommandService;
    readonly component: IComponentService;
    readonly cursor: ICursorService;
    readonly model: IModelService;
    readonly render: IRenderService;
    readonly layout: ILayoutService;
    readonly view: IViewService;
    readonly transform: ITransformService;
    readonly history: IHistoryService;
    readonly keyBinding: IKeyBindingService;
}

export interface IServiceRegistry {
    registerService<TKey extends keyof IServices>(key: TKey, service: IServices[TKey]): void;
    getService<TKey extends keyof IServices>(key: TKey): IServices[TKey];
}

export class ServiceRegistry implements IServiceRegistry {
    protected services: Partial<IServices> = {};

    registerService<TKey extends keyof IServices>(key: TKey, service: IServices[TKey]) {
        this.services[key] = service;
    }

    getService<TKey extends keyof IServices>(key: TKey) {
        const service = this.services[key];
        if (!service) {
            throw new Error(`Service ${key} is not registered.`);
        }
        return service as IServices[TKey];
    }
}
