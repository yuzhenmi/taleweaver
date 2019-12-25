import { ICommandService } from '../command/service';
import { IConfigService } from '../config/service';
import { IDidPressKeyEvent } from '../view/keyboard-observer';
import { IViewService } from '../view/service';

export interface IKeyBinding {
    command: string;
    args: any[];
}

export interface IKeyBindingService {}

export class KeyBindingService implements IKeyBindingService {
    protected keyBindings: Map<string, IKeyBinding> = new Map();

    constructor(
        protected configService: IConfigService,
        protected commandService: ICommandService,
        protected viewService: IViewService,
    ) {
        const keyBindingsConfig = this.configService.getConfig().keyBindings;
        for (let key in keyBindingsConfig) {
            const keyBindingConfig = keyBindingsConfig[key];
            this.keyBindings.set(key, {
                command: keyBindingConfig.command,
                args: keyBindingConfig.args || [],
            });
        }
        viewService.onDidPressKey(this.handleDidPressKey);
    }

    protected handleDidPressKey = (event: IDidPressKeyEvent) => {
        const keyBinding = this.keyBindings.get(event.key);
        if (!keyBinding) {
            return;
        }
        this.commandService.executeCommand(keyBinding.command, ...keyBinding.args);
    };
}
