import { ICommandService } from '../command/service';
import { IComponentService } from '../component/service';
import { ICursorService } from '../cursor/service';
import { IEventListener } from '../event/listener';
import { ILayoutService } from '../layout/service';
import { IRenderService } from '../render/service';
import { IService } from '../service/service';
import { CursorView, ICursorView } from './cursor';
import { IDocViewNode } from './doc-node';
import { DOMController, IDOMController } from './dom-controller';
import { IDidUpdateViewStateEvent, IViewState, ViewState } from './state';

export interface IViewService extends IService {
    onDidUpdateViewState(listener: IEventListener<IDidUpdateViewStateEvent>): void;
    getDocNode(): IDocViewNode;
    isFocused(): boolean;
    attach(domContainer: HTMLElement): void;
}

export class ViewService implements IViewService {
    protected state: IViewState;
    protected cursor: ICursorView;
    protected domController: IDOMController;

    constructor(
        instanceId: string,
        componentService: IComponentService,
        layoutService: ILayoutService,
        cursorService: ICursorService,
        renderService: IRenderService,
        commandService: ICommandService,
    ) {
        this.state = new ViewState(instanceId, componentService, layoutService);
        this.cursor = new CursorView(instanceId, cursorService, renderService, layoutService, this);
        this.domController = new DOMController(instanceId, commandService, this);
    }

    onDidUpdateViewState(listener: IEventListener<IDidUpdateViewStateEvent>) {
        this.state.onDidUpdateViewState(listener);
    }

    getDocNode() {
        return this.state.getDocNode();
    }

    isFocused() {
        return this.domController.isFocused();
    }

    attach(domContainer: HTMLElement) {
        this.state.attach(domContainer);
        this.cursor.attach();
        this.domController.attach();
    }
}
