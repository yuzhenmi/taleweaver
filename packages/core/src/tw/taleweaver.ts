import { CommandService, ICommandService } from './command/service';
import { ComponentService, IComponentService } from './component/service';
import { IExternalConfig } from './config/config';
import { ConfigService, IConfigService } from './config/service';
import { buildBaseConfig } from './config/util';
import { CursorService, ICursorService } from './cursor/service';
import { DOMService, IDOMService } from './dom/service';
import { HistoryService, IHistoryService } from './history/service';
import { IKeyBindingService, KeyBindingService } from './key-binding/service';
import { ILayoutService, LayoutService } from './layout/service';
import { IModelRoot } from './model/root';
import { IModelService, ModelService } from './model/service';
import { IRenderService, RenderService } from './render/service';
import { IServiceRegistry, ServiceRegistry } from './service/registry';
import { ITextService, TextService } from './text/service';
import { ITransformService, TransformService } from './transform/service';
import { generateId } from './util/id';
import { IViewService, ViewService } from './view/service';

export class Taleweaver {
    protected instanceId: string;
    protected serviceRegistry: IServiceRegistry;
    protected configService: IConfigService;
    protected domService: IDOMService;
    protected textService: ITextService;
    protected commandService: ICommandService;
    protected componentService: IComponentService;
    protected modelService: IModelService;
    protected renderService: IRenderService;
    protected cursorService: ICursorService;
    protected layoutService: ILayoutService;
    protected viewService: IViewService;
    protected transformService: ITransformService;
    protected historyService: IHistoryService;
    protected keyBindingService: IKeyBindingService;

    constructor(root: IModelRoot<any>, config: IExternalConfig) {
        this.instanceId = generateId();
        this.serviceRegistry = new ServiceRegistry();
        this.configService = new ConfigService(buildBaseConfig(), config);
        this.serviceRegistry.registerService('config', this.configService);
        this.domService = new DOMService();
        this.serviceRegistry.registerService('dom', this.domService);
        this.textService = new TextService(this.domService);
        this.serviceRegistry.registerService('text', this.textService);
        this.commandService = new CommandService(this.configService, this.serviceRegistry);
        this.serviceRegistry.registerService('command', this.commandService);
        this.componentService = new ComponentService(this.configService, this.serviceRegistry);
        this.serviceRegistry.registerService('component', this.componentService);
        this.modelService = new ModelService(root, this.componentService);
        this.serviceRegistry.registerService('model', this.modelService);
        this.renderService = new RenderService(this.componentService, this.modelService);
        this.serviceRegistry.registerService('render', this.renderService);
        this.cursorService = new CursorService(this.configService, this.renderService, this.modelService);
        this.serviceRegistry.registerService('cursor', this.cursorService);
        this.layoutService = new LayoutService(this.renderService, this.textService);
        this.serviceRegistry.registerService('layout', this.layoutService);
        this.transformService = new TransformService(
            this.modelService,
            this.componentService,
            this.cursorService,
            this.renderService,
            this.layoutService,
        );
        this.serviceRegistry.registerService('transform', this.transformService);
        this.viewService = new ViewService(
            this.instanceId,
            this.configService,
            this.domService,
            this.componentService,
            this.modelService,
            this.layoutService,
            this.cursorService,
            this.renderService,
            this.commandService,
            this.transformService,
        );
        this.serviceRegistry.registerService('view', this.viewService);
        this.historyService = new HistoryService(this.configService, this.transformService);
        this.serviceRegistry.registerService('history', this.historyService);
        this.keyBindingService = new KeyBindingService(this.configService, this.commandService, this.viewService);
        this.serviceRegistry.registerService('keyBinding', this.keyBindingService);
    }

    attach(domContainer: HTMLElement) {
        this.viewService.attach(domContainer);
    }

    getServiceRegistry() {
        return this.serviceRegistry;
    }
}
