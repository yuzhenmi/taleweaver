import { ICommandHandler } from 'tw/command/command';
import { IElement } from 'tw/element/element';

export interface IConfig {
    commands: {
        [key: string]: ICommandHandler;
    };
    elements: {
        [key: string]: IElement;
    };
    disableCursor?: boolean;
}

export interface IExternalConfig {
    'tw.core'?: {
        disableCursor?: boolean;
    };
    [extensionId: string]:
        | {
              [key: string]: any;
          }
        | undefined;
}
