import React from 'react';
import './App.css';
import TaleWeaver from './editor/TaleWeaver';
import Config from './editor/Config';
import Cursor from './editor/cursor/Cursor';

const initialMarkup = `
<Doc {"id": "1"}>
  <Paragraph {"id": "1-1"}>
    <Text {"id": "1-1-1"}>
      Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec luctus commodo magna eu gravida. Quisque et neque ornare nunc maximus faucibus. Ut molestie diam non interdum fringilla. In hac habitasse platea dictumst. Proin dignissim id diam a pharetra. Praesent nec arcu felis. Nam et cursus mi. Duis facilisis ex vel leo vulputate laoreet. Pellentesque turpis quam, sollicitudin at lobortis non, rhoncus eu neque. Quisque egestas, ex vitae porta accumsan, justo dui elementum nisi, et bibendum lectus diam ut mauris. Proin imperdiet vulputate congue. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Suspendisse nec tristique odio. Nulla eget tortor eu felis mattis mattis. Duis in nulla ultricies, egestas nunc ac, tempor tellus.
    <>
  <>
  <Paragraph {"id": "1-2"}>
    <Text {"id": "1-2-1"}>
      Cras condimentum nisi diam, vitae ornare libero porttitor at. Curabitur id nibh aliquam lacus malesuada tincidunt id eget mauris. Donec venenatis non ipsum quis fermentum. Vestibulum dignissim finibus neque, et mattis orci mollis id. Nunc pellentesque, neque sed fermentum fermentum, felis nunc porttitor lorem, et pulvinar leo quam ut elit. Quisque sit amet venenatis mauris. In hac habitasse platea dictumst. Praesent sem mauris, tincidunt ut sollicitudin et, molestie ac magna. Etiam faucibus porta dapibus. Cras velit augue, molestie id est in, ullamcorper sodales mauris. Nunc ullamcorper eros purus, eget placerat eros pharetra fermentum. Nunc ullamcorper euismod dui, tempor pulvinar mi pretium vel. Nullam nec nisi mi. Phasellus fermentum diam vel lacus bibendum imperdiet. Cras enim mi, cursus at velit feugiat, sagittis sagittis urna.
    <>
  <>
  <Paragraph {"id": "1-3"}>
    <Text {"id": "1-3-1"}>
      Maecenas id efficitur nulla, ornare posuere felis. Nulla lobortis tortor vel massa lobortis, sit amet rhoncus neque placerat. Curabitur maximus iaculis faucibus. In tincidunt posuere justo at pulvinar. Maecenas viverra at odio nec porta. Pellentesque ultrices eros vitae velit scelerisque, et tempor lectus sodales. Duis tempus quam nec tortor consequat consectetur. Nulla facilisi. Nam id lectus magna. Nulla metus mauris, tincidunt at ante a, pulvinar tincidunt metus. Nulla nec magna sit amet sapien feugiat commodo at in dolor. Aenean mauris enim, posuere et dolor quis, ornare sollicitudin dui. Vivamus aliquet metus turpis, in maximus enim aliquam in. Sed vel quam vitae metus condimentum aliquam.
    <>
  <>
  <Paragraph {"id": "1-4"}>
    <Text {"id": "1-4-1"}>
      Suspendisse egestas vulputate arcu, ut laoreet felis feugiat sed. Donec dui sem, aliquet euismod sollicitudin sed, cursus non urna. Ut blandit enim diam, vitae rhoncus nisl accumsan non. Nulla facilisi. Vestibulum nec scelerisque augue, sed volutpat est. Integer augue turpis, varius ac velit non, ornare venenatis lectus. Nullam porta neque vel risus semper ornare id a enim. Cras tristique non quam quis commodo.
    <>
  <>
  <Paragraph {"id": "1-5"}>
    <Text {"id": "1-5-1"}>
      Fusce condimentum arcu et diam faucibus, sit amet mattis velit pharetra. Praesent sagittis rhoncus libero, placerat ornare dui varius eget. Fusce consequat metus ut dignissim luctus. In congue lectus ut magna varius, at aliquam mi rutrum. Nam eu nunc eu ipsum varius pulvinar ac ut nulla. Nullam non elit neque. Vestibulum quis molestie dolor, eu vehicula risus. Sed luctus velit sem, id vestibulum orci blandit at. In aliquam gravida aliquam. Vivamus semper vulputate purus eu vehicula. Ut condimentum quis velit et feugiat. Curabitur eget ex eget mi interdum condimentum eget sit amet purus. Aliquam et libero erat. Aliquam erat volutpat.
    <>
  <>
<>
`.split('\n').map(line => line.trim()).join('');

type TaleWeaverComponentProps = {
  initialMarkup: string;
}
type TaleWeaverComponentState = {
  taleWeaver: TaleWeaver;
}
class TaleWeaverComponent extends React.Component<TaleWeaverComponentProps, TaleWeaverComponentState> {
  private domRef: React.RefObject<HTMLDivElement>;

  constructor(props: TaleWeaverComponentProps) {
    super(props);
    this.domRef = React.createRef();
    const config = new Config();
    const taleWeaver = new TaleWeaver(config, props.initialMarkup);
    const editorCursor = new Cursor(0, 0);
    taleWeaver.setEditorCursor(editorCursor);
    this.state = { taleWeaver };
  }

  componentDidMount() {
    const domElement = this.domRef.current!;
    this.state.taleWeaver.mount(domElement);
  }

  render() {
    return (
      <div className="tw--container" ref={this.domRef} />
    );
  }
}

class App extends React.Component {
  render() {
    return (
      <div className="app">
        <TaleWeaverComponent initialMarkup={initialMarkup} />
      </div>
    );
  }
}

export default App;
