import { ICommandHandler } from '../command/command';
import { IComponent } from '../component/component';

export interface ICommandsConfig {
    [key: string]: ICommandHandler;
}

export interface IComponentsConfig {
    [key: string]: IComponent;
}

export interface ICursorConfig {
    disable: boolean;
}

export interface IHistoryConfig {
    collapseThreshold: number;
    maxCollapseDuration: number;
}

export interface IPlatformKeyBindings {
    [key: string]: {
        command: string;
        args?: any[];
    };
}

export interface IKeyBindingsConfig {
    common: IPlatformKeyBindings;
    macos: IPlatformKeyBindings;
    windows: IPlatformKeyBindings;
    linux: IPlatformKeyBindings;
}

export interface IPageConfig {
    width: number;
    height: number;
    paddingTop: number;
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
}

export interface IConfig {
    commands: ICommandsConfig;
    components: IComponentsConfig;
    cursor: ICursorConfig;
    history: IHistoryConfig;
    keyBindings: IKeyBindingsConfig;
    page: IPageConfig;
}

export type ICoreConfig = Partial<IConfig>;

export interface IExtensionConfig {
    [key: string]: any;
}

export interface IExternalConfig {
    'tw.core'?: ICoreConfig;
    [extensionId: string]: IExtensionConfig | undefined;
}
