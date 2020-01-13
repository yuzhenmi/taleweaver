import { ICommandService } from '../command/service';
import { IPlatformKeyBindings } from '../config/config';
import { IConfigService } from '../config/service';
import { detectPlatform } from '../util/platform';
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
        this.bindKeys(keyBindingsConfig.common);
        switch (detectPlatform()) {
            case 'macOS':
                if (keyBindingsConfig.macos) {
                    this.bindKeys(keyBindingsConfig.macos);
                }
                break;
            case 'Windows':
                if (keyBindingsConfig.windows) {
                    this.bindKeys(keyBindingsConfig.windows);
                }
                break;
            case 'Linux':
                if (keyBindingsConfig.linux) {
                    this.bindKeys(keyBindingsConfig.linux);
                }
                break;
        }
        viewService.onDidPressKey(this.handleDidPressKey);
    }

    protected bindKeys(config: IPlatformKeyBindings) {
        for (let key in config) {
            const binding = config[key];
            this.keyBindings.set(key, {
                command: binding.command,
                args: binding.args || [],
            });
        }
    }

    protected handleDidPressKey = (event: IDidPressKeyEvent) => {
        const keyBinding = this.keyBindings.get(event.key);
        if (!keyBinding) {
            return;
        }
        this.commandService.executeCommand(keyBinding.command, ...keyBinding.args);
    };
}
