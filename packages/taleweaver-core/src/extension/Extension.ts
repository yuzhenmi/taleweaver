import ExtensionProvider from './ExtensionProvider';

export default abstract class Extension {
  private provider?: ExtensionProvider;

  onRegistered(provider: ExtensionProvider) {
    this.provider = provider;
  }

  getProvider(): ExtensionProvider {
    if (!this.provider) {
      throw new Error('Extension has not yet been registered.');
    }
    return this.provider;
  }

  onReflowed?(): void;
}
