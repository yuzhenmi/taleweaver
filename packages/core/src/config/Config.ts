import ElementConfig from './ElementConfig';
import KeyBindingConfig from './KeyBindingConfig';
import PageConfig from './PageConfig';
import FontConfig from './FontConfig';

class Config {
  protected elementConfig = new ElementConfig();
  protected keyBindingConfig = new KeyBindingConfig();
  protected pageConfig = new PageConfig();
  protected fontConfig: FontConfig = new FontConfig();

  getElementConfig() {
    return this.elementConfig;
  }

  getKeyBindingConfig() {
    return this.keyBindingConfig;
  }

  getPageConfig() {
    return this.pageConfig;
  }

  getFontConfig() {
    return this.fontConfig;
  }
}

export default Config;
