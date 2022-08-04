import { IViewService } from '../../view/service';
import { CommandHandler } from '../command';

export class FocusCommandHandler implements CommandHandler {
    static readonly dependencies = ['view'] as const;

    constructor(protected viewService: IViewService) {}

    async handle() {
        this.viewService.requestFocus();
    }
}

export class BlurCommandHandler implements CommandHandler {
    static readonly dependencies = ['view'] as const;

    constructor(protected viewService: IViewService) {}

    async handle() {
        this.viewService.requestBlur();
    }
}
