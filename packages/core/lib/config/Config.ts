import KeyBindingConfig from './KeyBindingConfig';
import NodeConfig from './NodeConfig';
import PageConfig from './PageConfig';
import TextConfig from './TextConfig';

class Config {
    protected nodeConfig = new NodeConfig();
    protected keyBindingConfig = new KeyBindingConfig();
    protected pageConfig = new PageConfig();
    protected textConfig: TextConfig = new TextConfig();

    getNodeConfig() {
        return this.nodeConfig;
    }

    getKeyBindingConfig() {
        return this.keyBindingConfig;
    }

    getPageConfig() {
        return this.pageConfig;
    }

    getTextConfig() {
        return this.textConfig;
    }
}

export default Config;
