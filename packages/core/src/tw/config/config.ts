import { ICommandHandler } from '../command/command';
import { IComponent } from '../component/component';

export interface IConfig {
    commands: {
        [key: string]: ICommandHandler;
    };
    components: {
        [key: string]: IComponent;
    };
    disableCursor?: boolean;
}

export interface ICoreConfig {
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
