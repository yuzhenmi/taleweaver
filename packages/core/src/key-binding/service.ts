import { CommandService } from '../command/service';
import { PlatformKeyBindings } from '../config/config';
import { ConfigService } from '../config/service';
import { detectPlatform } from '../util/platform';
import { DidPressKeyEvent } from '../view/keyboard-observer';
import { IViewService } from '../view/service';

export interface KeyBinding {
    command: string;
    args: any[];
    preventDefault: boolean;
}

export class KeyBindingService {
    protected keyBindings: Map<string, KeyBinding> = new Map();

    constructor(
        protected configService: ConfigService,
        protected commandService: CommandService,
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

    protected bindKeys(config: PlatformKeyBindings) {
        for (let key in config) {
            const binding = config[key];
            this.keyBindings.set(key, {
                command: binding.command,
                args: binding.args || [],
                preventDefault: binding.preventDefault || false,
            });
        }
    }

    protected handleDidPressKey = (event: DidPressKeyEvent) => {
        const keyBinding = this.keyBindings.get(event.key);
        if (!keyBinding) {
            return;
        }
        if (keyBinding.preventDefault) {
            event.originalKeyboardEvent.preventDefault();
        }
        this.commandService.executeCommand(keyBinding.command, ...keyBinding.args);
    };
}
