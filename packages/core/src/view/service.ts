import { CommandService } from '../command/service';
import { ConfigService } from '../config/service';
import { CursorService } from '../cursor/service';
import { DOMService } from '../dom/service';
import { EventListener } from '../event/listener';
import { LayoutService } from '../layout/service';
import { ModelService } from '../model/service';
import { TransformService } from '../transform/service';
import { CursorView } from './cursor';
import { DOMController } from './dom-controller';
import { DidBlurEvent, DidFocusEvent } from './focus-observer';
import { DidPressKeyEvent } from './keyboard-observer';
import { DocViewNode } from './nodes/doc';
import { IDidUpdateViewStateEvent, IViewState, ViewState } from './state';

export interface IViewService {
    onDidUpdateViewState(listener: EventListener<IDidUpdateViewStateEvent>): void;
    onDidFocus(listener: EventListener<DidFocusEvent>): void;
    onDidBlur(listener: EventListener<DidBlurEvent>): void;
    onDidPressKey(listener: EventListener<DidPressKeyEvent>): void;
    getDoc(): DocViewNode;
    getDOMContainer(): HTMLElement | null;
    isFocused(): boolean;
    attach(domContainer: HTMLElement): void;
    requestFocus(): void;
    requestBlur(): void;
}

export class ViewService implements IViewService {
    protected state: IViewState;
    protected cursor: CursorView;
    protected domController: DOMController;

    constructor(
        instanceId: string,
        configService: ConfigService,
        domService: DOMService,
        modelService: ModelService,
        layoutService: LayoutService,
        cursorService: CursorService,
        commandService: CommandService,
        transformService: TransformService,
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

    onDidUpdateViewState(listener: EventListener<IDidUpdateViewStateEvent>) {
        this.state.onDidUpdate(listener);
    }

    onDidFocus(listener: EventListener<DidFocusEvent>) {
        this.domController.onDidFocus(listener);
    }

    onDidBlur(listener: EventListener<DidBlurEvent>) {
        this.domController.onDidBlur(listener);
    }

    onDidPressKey(listener: EventListener<DidPressKeyEvent>) {
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
