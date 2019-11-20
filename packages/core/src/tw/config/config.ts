import { ICommandHandler } from 'tw/command/command';
import { IElement } from 'tw/element/element';

export interface IConfig {
    commands: Map<string, ICommandHandler>;
    elements: Map<string, IElement>;
    disableCursor?: boolean;
}

export interface IExternalConfig {
    'tw.core': {
        disableCursor?: boolean;
    };
    [extensionId: string]: {
        [key: string]: any;
    };
}
