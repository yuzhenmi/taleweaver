import { ICommandService } from '../command/service';
import { IConfigService } from '../config/service';
import { ICursorService } from '../cursor/service';
import { IDOMService } from '../dom/service';
import { IEventListener } from '../event/listener';
import { ILayoutService } from '../layout/service';
import { IModelService } from '../model/service';
import { ITransformService } from '../transform/service';
import { CursorView, ICursorView } from './cursor';
import { DOMController, IDOMController } from './dom-controller';
import { IDidBlurEvent, IDidFocusEvent } from './focus-observer';
import { IDidPressKeyEvent } from './keyboard-observer';
import { IDocViewNode } from './node';
import { IDidUpdateViewStateEvent, IViewState, ViewState } from './state';

export interface IViewService {
    onDidUpdateViewState(listener: IEventListener<IDidUpdateViewStateEvent>): void;
    onDidFocus(listener: IEventListener<IDidFocusEvent>): void;
    onDidBlur(listener: IEventListener<IDidBlurEvent>): void;
    onDidPressKey(listener: IEventListener<IDidPressKeyEvent>): void;
    getDoc(): IDocViewNode;
    getDOMContainer(): HTMLElement | null;
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
        configService: IConfigService,
        domService: IDOMService,
        modelService: IModelService,
        layoutService: ILayoutService,
        cursorService: ICursorService,
        commandService: ICommandService,
        transformService: ITransformService,
    ) {
        this.state = new ViewState(instanceId, layoutService, domService);
        this.domController = new DOMController(
            instanceId,
            this.state,
            domService,
            commandService,
            modelService,
            layoutService,
        );
        this.cursor = new CursorView(
            instanceId,
            configService,
            domService,
            cursorService,
            layoutService,
            this,
            transformService,
        );
    }

    onDidUpdateViewState(listener: IEventListener<IDidUpdateViewStateEvent>) {
        this.state.onDidUpdate(listener);
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

    getDoc() {
        return this.state.doc;
    }

    getDOMContainer() {
        return this.state.domContainer;
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
