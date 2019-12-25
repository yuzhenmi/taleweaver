import { ICommandHandler } from '../command/command';
import { IComponent } from '../component/component';

interface IPageConfig {
    width: number;
    height: number;
    paddingTop: number;
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
}

export interface IConfig {
    commands: {
        [key: string]: ICommandHandler;
    };
    keyBindings: {
        [key: string]: {
            command: string;
            args?: any[];
        };
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
