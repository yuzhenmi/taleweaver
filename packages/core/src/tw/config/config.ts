import { ICommandHandler } from '../command/command';
import { IComponent } from '../component/component';

export interface IPageConfig {
    width: number;
    height: number;
    paddingTop: number;
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
}

export interface IKeyBindingsConfig {
    [key: string]: {
        command: string;
        args?: any[];
    };
}

export interface IConfig {
    commands: {
        [key: string]: ICommandHandler;
    };
    keyBindings: {
        common: IKeyBindingsConfig;
        macos?: IKeyBindingsConfig;
        windows?: IKeyBindingsConfig;
        linux?: IKeyBindingsConfig;
    };
    components: {
        [key: string]: IComponent;
    };
    page: IPageConfig;
    disableCursor?: boolean;
}

export interface ICoreConfig {
    page?: IPageConfig;
    disableCursor?: boolean;
    ssr?: boolean;
}

export interface IExtensionConfig {
    [key: string]: any;
}

export interface IExternalConfig {
    'tw.core'?: ICoreConfig;
    [extensionId: string]: IExtensionConfig | undefined;
}
