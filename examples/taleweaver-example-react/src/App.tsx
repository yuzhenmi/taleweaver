import React from 'react';;
import styled from 'styled-components';
import './App.css';
import Editor from './Editor';

const initialMarkup = `
<Doc {"id": "{{id}}"}>
  <Paragraph {"id": "{{id}}"}>
    <Text {"id": "{{id}}"}>
      This is the document, start typing here.
    </>
  </>
</>
`.split('\n').map(line => line.trim()).join('').replace(/\.<\/>/g, '.\n</>').replace(/{{id}}/g, () => `${Math.random().toString(36).substring(2)}`);



const Wrapper = styled.div`
`;

const Hero = styled.div`
  text-align: center;
  padding: 90px 60px;
  background: rgba(0, 0, 0, 0.04);
`;

const BrandWrapper = styled.div`
`;

const Brand = styled.span`
  color: rgba(0, 0, 0, 0.65);
  font-size: 42px;
  letter-spacing: 0.02em;
  padding-bottom: 10px;
  border-bottom: 2px solid rgba(0, 0, 0, 0.65);
`;

const Tagline = styled.h1`
  font-size: 30px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.85);
  margin: 90px 0 0;
`;

const SupportingTagline = styled.h2`
  font-size: 20px;
  font-weight: 400;
  color: rgba(0, 0, 0, 0.85);
  margin: 30px 0 0;
`;

const Links = styled.div`
  margin-top: 90px;
`;

const Link = styled.a`
  display: inline-block;
  padding: 15px 60px;
  outline: none;
  color: rgba(0, 0, 0, 0.85);
  text-decoration: none;
  font-size: 20px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 3px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  &:hover {
    color: rgba(0, 0, 0, 1);
    background: rgba(0, 0, 0, 0.09);
    border-color: rgba(0, 0, 0, 0.25);
  }
`;

const DemoHintWrapper = styled.div`
  text-align: center;
  background: rgba(0, 0, 0, 0.04);
  padding-bottom: 30px;
`;

const DemoHint = styled.span`
  text-transform: uppercase;
  font-weight: 500;
  font-size: 14px;
  color: rgba(0, 0, 0, 0.65);
  border-top: 1px solid rgba(0, 0, 0, 0.45);
  padding-top: 10px;
  cursor: default;
`;

class App extends React.Component {
  render() {
    return (
      <Wrapper>
        <Hero>
          <BrandWrapper>
            <Brand>Taleweaver</Brand>
          </BrandWrapper>
          <Tagline>Word processing in your browser.</Tagline>
          <SupportingTagline>Open source editor delivering true word processing experience.</SupportingTagline>
          <Links>
            <Link href="https://github.com/yuzhenmi/taleweaver">GitHub</Link>
          </Links>
        </Hero>
        <DemoHintWrapper>
          <DemoHint>&darr; Check it out &darr;</DemoHint>
        </DemoHintWrapper>
        <Editor initialMarkup={initialMarkup} />
      </Wrapper>
    );
  }
}

export default App;
