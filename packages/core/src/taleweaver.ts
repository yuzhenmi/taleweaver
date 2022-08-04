import { CommandService } from './command/service';
import { ComponentService } from './component/service';
import { ExternalConfig } from './config/config';
import { ConfigService } from './config/service';
import { buildBaseConfig } from './config/util';
import { CursorService } from './cursor/service';
import { DOMService } from './dom/service';
import { HistoryService } from './history/service';
import { KeyBindingService } from './key-binding/service';
import { LayoutService } from './layout/service';
import { MarkService } from './mark/service';
import { ModelNodeData, Serializer } from './model/serializer';
import { ModelService } from './model/service';
import { RenderService } from './render/service';
import { ServiceRegistry } from './service/registry';
import { TextService } from './text/service';
import { TransformService } from './transform/service';
import { generateId } from './util/id';
import { IViewService, ViewService } from './view/service';

export class Taleweaver {
    protected instanceId: string;
    protected serviceRegistry: ServiceRegistry;
    protected configService: ConfigService;
    protected domService: DOMService;
    protected textService: TextService;
    protected commandService: CommandService;
    protected componentService: ComponentService;
    protected modelService: ModelService;
    protected markService: MarkService;
    protected renderService: RenderService;
    protected cursorService: CursorService;
    protected layoutService: LayoutService;
    protected viewService: IViewService;
    protected transformService: TransformService;
    protected historyService: HistoryService;
    protected keyBindingService: KeyBindingService;

    constructor(doc: ModelNodeData, config: ExternalConfig) {
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
        this.componentService = new ComponentService(this.configService);
        this.serviceRegistry.registerService('component', this.componentService);
        const serializer = new Serializer(this.componentService);
        this.modelService = new ModelService(serializer.parse(doc));
        this.serviceRegistry.registerService('model', this.modelService);
        this.markService = new MarkService(this.configService);
        this.serviceRegistry.registerService('mark', this.markService);
        this.renderService = new RenderService(this.modelService, this.componentService, this.markService);
        this.serviceRegistry.registerService('render', this.renderService);
        this.cursorService = new CursorService(this.configService);
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
            this.modelService,
            this.layoutService,
            this.cursorService,
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
