import { ConfigServiceStub } from '../config/service.stub';
import { TextServiceStub } from '../text/service.stub';
import { DocComponent } from './components/doc';
import { LineComponent } from './components/line';
import { PageComponent } from './components/page';
import { ParagraphComponent } from './components/paragraph';
import { TextComponent } from './components/text';
import { IComponentService } from './service';

export class ComponentServiceStub implements IComponentService {
    protected docComponent = new DocComponent('doc', new ConfigServiceStub());
    protected paragraphComponent = new ParagraphComponent('paragraph');
    protected textComponent = new TextComponent('text', new TextServiceStub());
    protected pageComponent = new PageComponent('page', new ConfigServiceStub());
    protected lineComponent = new LineComponent('line');

    getComponent(componentId: string) {
        switch (componentId) {
            case 'doc':
                return this.docComponent;
            case 'paragraph':
                return this.paragraphComponent;
            case 'text':
                return this.textComponent;
            default:
                throw new Error(`Unknown component ID: ${componentId}`);
        }
    }

    getPageComponent() {
        return this.pageComponent;
    }

    getLineComponent() {
        return this.lineComponent;
    }
}
