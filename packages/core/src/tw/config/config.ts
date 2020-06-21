import { ICommandHandler } from '../command/command';
import { IComponent } from '../component/component';
import { IServiceRegistry } from '../service/registry';

interface IComponentClass {
    new (id: string, serviceRegistry: IServiceRegistry): IComponent;
}

export interface ICommandsConfig {
    [key: string]: ICommandHandler;
}

export interface IComponentsConfig {
    [key: string]: IComponentClass;
}

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
