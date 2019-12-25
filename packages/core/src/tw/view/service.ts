import { ICommandService } from '../command/service';
import { IComponentService } from '../component/service';
import { ICursorService } from '../cursor/service';
import { IEventListener } from '../event/listener';
import { ILayoutService } from '../layout/service';
import { IRenderService } from '../render/service';
import { CursorView, ICursorView } from './cursor';
import { IDocViewNode } from './doc-node';
import { DOMController, IDOMController } from './dom-controller';
import { IDidBlurEvent, IDidFocusEvent } from './focus-observer';
import { IDidPressKeyEvent } from './keyboard-observer';
import { IDidUpdateViewStateEvent, IViewState, ViewState } from './state';

export interface IViewService {
    onDidUpdateViewState(listener: IEventListener<IDidUpdateViewStateEvent>): void;
    onDidFocus(listener: IEventListener<IDidFocusEvent>): void;
    onDidBlur(listener: IEventListener<IDidBlurEvent>): void;
    onDidPressKey(listener: IEventListener<IDidPressKeyEvent>): void;
    getDocNode(): IDocViewNode;
    isFocused(): boolean;
    attach(domContainer: HTMLElement): void;
    requestFocus(): void;
    requestBlur(): void;
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
        this.domController = new DOMController(instanceId, commandService, this);
        this.cursor = new CursorView(instanceId, cursorService, renderService, layoutService, this);
    }

    onDidUpdateViewState(listener: IEventListener<IDidUpdateViewStateEvent>) {
        this.state.onDidUpdateViewState(listener);
    }

    onDidFocus(listener: IEventListener<IDidFocusEvent>) {
        this.domController.onDidFocus(listener);
    }

    onDidBlur(listener: IEventListener<IDidBlurEvent>) {
        this.domController.onDidBlur(listener);
    }

    onDidPressKey(listener: IEventListener<IDidPressKeyEvent>) {
        this.domController.onDidPressKey(listener);
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

    requestFocus() {
        this.domController.requestFocus();
    }

    requestBlur() {
        this.domController.requestBlur();
    }
}
