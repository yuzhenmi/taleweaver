import { ICommandHandlerClass } from '../command/command';
import { IComponent } from '../component/component';
import { IMarkType } from '../mark/mark';

export interface ICommandsConfig {
    [key: string]: ICommandHandlerClass;
}

export type IComponentsConfig = IComponent<any>[];

export interface ICursorConfig {
    disable: boolean;
    caretColor: string;
    caretInactiveColor: string;
    selectionColor: string;
    selectionInactiveColor: string;
}

export interface IHistoryConfig {
    collapseThreshold: number;
    maxCollapseDuration: number;
}

export interface IPlatformKeyBindings {
    [key: string]: {
        command: string;
        args?: any[];
        preventDefault?: boolean;
    };
}

export interface IKeyBindingsConfig {
    common: IPlatformKeyBindings;
    macos: IPlatformKeyBindings;
    windows: IPlatformKeyBindings;
    linux: IPlatformKeyBindings;
}

export type IMarkTypesConfig = IMarkType<any>[];

export interface IConfig {
    commands: ICommandsConfig;
    components: IComponentsConfig;
    cursor: ICursorConfig;
    history: IHistoryConfig;
    keyBindings: IKeyBindingsConfig;
    markTypes: IMarkTypesConfig;
}

export type ICoreConfig = Partial<IConfig>;

export interface IExtensionConfig {
    [key: string]: any;
}

export interface IExternalConfig {
    'tw.core'?: ICoreConfig;
    [extensionId: string]: IExtensionConfig | undefined;
}
