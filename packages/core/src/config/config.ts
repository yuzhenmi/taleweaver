import { CommandHandlerClass } from '../command/command';
import { Component } from '../component/component';
import { MarkType } from '../mark/mark';

export interface CommandsConfig {
    [key: string]: CommandHandlerClass;
}

export type ComponentsConfig = { [componentId: string]: Component<unknown> };

export interface CursorConfig {
    disable: boolean;
    caretColor: string;
    caretInactiveColor: string;
    selectionColor: string;
    selectionInactiveColor: string;
}

export interface HistoryConfig {
    collapseThreshold: number;
    maxCollapseDuration: number;
}

export interface PlatformKeyBindings {
    [key: string]: {
        command: string;
        args?: any[];
        preventDefault?: boolean;
    };
}

export interface KeyBindingsConfig {
    common: PlatformKeyBindings;
    macos: PlatformKeyBindings;
    windows: PlatformKeyBindings;
    linux: PlatformKeyBindings;
}

export type MarkTypesConfig = MarkType<any>[];

export interface Config {
    commands: CommandsConfig;
    components: ComponentsConfig;
    cursor: CursorConfig;
    history: HistoryConfig;
    keyBindings: KeyBindingsConfig;
    markTypes: MarkTypesConfig;
}

export type CoreConfig = Partial<Config>;

export interface ExtensionConfig {
    [key: string]: any;
}

export interface ExternalConfig {
    'tw.core'?: CoreConfig;
    [extensionId: string]: ExtensionConfig | undefined;
}
