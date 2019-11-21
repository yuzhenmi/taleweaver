import { ICommandHandler } from 'tw/command/command';
import { IComponent } from 'tw/component/component';

export interface IConfig {
    commands: {
        [key: string]: ICommandHandler;
    };
    components: {
        [key: string]: IComponent;
    };
    initialMarkup: string;
    disableCursor?: boolean;
}

export interface IExternalConfig {
    'tw.core'?: {
        initialMarkup?: string;
        disableCursor?: boolean;
    };
    [extensionId: string]:
        | {
              [key: string]: any;
          }
        | undefined;
}
