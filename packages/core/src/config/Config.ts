import ElementConfig from './ElementConfig';
import KeyBindingConfig from './KeyBindingConfig';
import PageConfig from './PageConfig';
import TextConfig from './TextConfig';

class Config {
  protected elementConfig = new ElementConfig();
  protected keyBindingConfig = new KeyBindingConfig();
  protected pageConfig = new PageConfig();
  protected textConfig: TextConfig = new TextConfig();

  getElementConfig() {
    return this.elementConfig;
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
