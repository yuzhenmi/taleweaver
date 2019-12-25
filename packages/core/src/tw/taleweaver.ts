import * as viewCommandHandlers from './command/handlers/view';
import { CommandService, ICommandService } from './command/service';
import { DocComponent } from './component/components/doc';
import { ParagraphComponent } from './component/components/paragraph';
import { TextComponent, TextMeasurer } from './component/components/text';
import { ComponentService, IComponentService } from './component/service';
import { IConfig, IExternalConfig } from './config/config';
import { ConfigService, IConfigService } from './config/service';
import { CursorService, ICursorService } from './cursor/service';
import { ILayoutService, LayoutService } from './layout/service';
import { IModelService, ModelService } from './model/service';
import { IRenderService, RenderService } from './render/service';
import { IServiceRegistry, ServiceRegistry } from './service/registry';
import { IStateService, StateService } from './state/service';
import { generateId } from './util/id';
import { IViewService, ViewService } from './view/service';

export interface ITaleweaver {
    attach(domContainer: HTMLElement): void;
}

export class Taleweaver {
    protected instanceId: string;
    protected serviceRegistry: IServiceRegistry;
    protected configService: IConfigService;
    protected commandService: ICommandService;
    protected componentService: IComponentService;
    protected cursorService: ICursorService;
    protected stateService: IStateService;
    protected modelService: IModelService;
    protected renderService: IRenderService;
    protected layoutService: ILayoutService;
    protected viewService: IViewService;

    constructor(initialMarkup: string, config: IExternalConfig) {
        this.instanceId = generateId();
        this.serviceRegistry = new ServiceRegistry();
        this.configService = new ConfigService(this.buildBaseConfig(), config);
        this.commandService = new CommandService(this.configService, this.serviceRegistry);
        this.componentService = new ComponentService(this.configService);
        this.cursorService = new CursorService(this.configService);
        this.stateService = new StateService(this.cursorService, initialMarkup);
        this.modelService = new ModelService(this.componentService, this.stateService);
        this.renderService = new RenderService(this.componentService, this.modelService);
        this.layoutService = new LayoutService(this.componentService, this.renderService);
        this.viewService = new ViewService(
            this.instanceId,
            this.componentService,
            this.layoutService,
            this.cursorService,
            this.renderService,
            this.commandService,
        );
        this.registerServices();
    }

    attach(domContainer: HTMLElement) {
        this.viewService.attach(domContainer);
    }

    protected buildBaseConfig(): IConfig {
        return {
            commands: {
                'tw.view.focus': viewCommandHandlers.focus,
                'tw.view.blur': viewCommandHandlers.blur,
            },
            components: {
                doc: new DocComponent('doc'),
                paragraph: new ParagraphComponent('paragraph'),
                text: new TextComponent('text', new TextMeasurer()),
            },
            page: {
                width: 816,
                height: 1056,
                paddingTop: 40,
                paddingBottom: 40,
                paddingLeft: 40,
                paddingRight: 40,
            },
        };
    }

    protected registerServices() {
        this.serviceRegistry.registerService('config', this.configService);
        this.serviceRegistry.registerService('command', this.commandService);
        this.serviceRegistry.registerService('component', this.componentService);
        this.serviceRegistry.registerService('cursor', this.cursorService);
        this.serviceRegistry.registerService('state', this.stateService);
        this.serviceRegistry.registerService('model', this.modelService);
        this.serviceRegistry.registerService('render', this.renderService);
        this.serviceRegistry.registerService('layout', this.layoutService);
        this.serviceRegistry.registerService('view', this.viewService);
    }
}
