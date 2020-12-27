import { IViewService } from '../../view/service';
import { ICommandHandler } from '../command';

export class FocusCommandHandler implements ICommandHandler {
    static readonly dependencies = ['view'] as const;

    constructor(protected viewService: IViewService) {}

    async handle() {
        this.viewService.requestFocus();
    }
}

export class BlurCommandHandler implements ICommandHandler {
    static readonly dependencies = ['view'] as const;

    constructor(protected viewService: IViewService) {}

    async handle() {
        this.viewService.requestBlur();
    }
}
