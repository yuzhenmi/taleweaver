import { IConfig } from './config';

export function buildStubConfig(): IConfig {
    return {
        commands: {},
        components: {},
        cursor: {
            disable: false,
        },
        history: {
            collapseThreshold: 500,
            maxCollapseDuration: 2000,
        },
        keyBindings: {
            common: {},
            macos: {},
            windows: {},
            linux: {},
        },
        page: {
            width: 816,
            height: 1056,
            paddingTop: 40,
            paddingBottom: 40,
            paddingLeft: 40,
            paddingRight: 40,
        },
    };
}
