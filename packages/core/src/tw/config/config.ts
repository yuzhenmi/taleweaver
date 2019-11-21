import { ICommandHandler } from 'tw/command/command';
import { IComponent } from 'tw/component/component';

export interface IConfig {
    commands: {
        [key: string]: ICommandHandler;
    };
    components: {
        [key: string]: IComponent;
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
