import React from 'react';;
import styled from 'styled-components';
import { TextStyle } from '@taleweaver/core';

const DockedPlaceholder = styled.div`
  height: 42px;
`;

interface WrapperProps {
  isDocked: boolean;
}

const Wrapper = styled.div<WrapperProps>`
  padding: 3px 24px;
  background: white;
  ${({ isDocked }) => isDocked && `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.09);
  `}
`;

const InnerWrapper = styled.div`
  display: flex;
  width: 816px;
  margin: 0 auto;
`;

const Group = styled.div`
  flex: 0 0 auto;
  display: flex;
  border-radius: 4px;
  padding: 0 6px;
  position: relative;
  &::before {
    content: "";
    position: absolute;
    top: 9px;
    bottom: 9px;
    left: 0;
    width: 1px;
    background: rgba(0, 0, 0, 0.15);
  }
  &:last-child {
    &::after {
      content: "";
      position: absolute;
      top: 9px;
      bottom: 9px;
      right: 0;
      width: 1px;
      background: rgba(0, 0, 0, 0.15);
    }
  }
`;

interface ItemProps {
  disabled: boolean;
  active: boolean;
}

const Item = styled.button<ItemProps>`
  flex: 0 0 auto;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 36px;
  height: 36px;
  font-size: 18px;
  position: relative;
  color: rgba(0, 0, 0, 0.85);
  border: none;
  border-radius: 3px;
  outline: none;
  &:after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 3px;
    right: 3px;
    height: 3px;
  }
  &:hover, &:focus {
    background: rgba(0, 0, 0, 0.04);
  }
  ${({ disabled }) => disabled && `
    opacity: 0.45;
  `}
  ${({ active }) => active && `
    color: rgba(255, 0, 0, 1);
    &:after {
      background: rgba(255, 0, 0, 1);
    }
  `}
`;

interface SelectItemProps {
  disabled: boolean;
  width: number;
}

const SelectItem = styled.select<SelectItemProps>`
  -webkit-appearance: none;
  border: none;
  font-size: 12px;
  font-weight: 500;
  width: ${({ width }) => width}px;
  background: white;
  border-radius: 3px;
  padding: 0 9px;
  outline: none;
  position: relative;
  &:hover, &:focus {
    background: rgba(0, 0, 0, 0.04);
  }
  option {
    color: rgba(0, 0, 0, 0.85);
  }
  ${({ disabled }) => disabled && `
    opacity: 0.45;
  `}
`;

interface ItemColorLineProps {
  color: string;
}

const ItemColorLine = styled.div<ItemColorLineProps>`
  position: absolute;
  bottom: 8px;
  left: 9px;
  right: 9px;
  height: 3px;
  background: ${({ color }) => color};
`;

interface Props {
  textStyle: TextStyle | null;
}

interface State {
  isDocked: boolean;
}

class ToolBar extends React.Component<Props, State> {
  protected top = 0;
  protected ref = React.createRef<HTMLDivElement>();
  state = {
    isDocked: false,
  };

  componentDidMount() {
    this.top = this.ref.current!.offsetTop;
    window.addEventListener('scroll', this.handleScroll);
  }

  componentWillUnmount() {
    window.removeEventListener('scroll', this.handleScroll);
  }

  handleScroll = () => {
    const isDocked = window.scrollY >= this.top;
    if (this.state.isDocked !== isDocked) {
      this.setState({ isDocked });
    }
  }

  render () {
    const { textStyle } = this.props;
    const { isDocked } = this.state;
    return (
      <>
        {isDocked && <DockedPlaceholder />}
        <Wrapper ref={this.ref} isDocked={isDocked}>
          <InnerWrapper>
            <Group>
              <SelectItem width={120} value="Normal" disabled={!textStyle}>
                <option value="Normal">Normal text</option>
                <option value="Title">Title</option>
                <option value="Subtitle">Subtitle</option>
                <option value="Heading 1">Heading 1</option>
                <option value="Heading 2">Heading 2</option>
                <option value="Heading 3">Heading 3</option>
              </SelectItem>
            </Group>
            <Group>
              <SelectItem width={120} value="Arial" disabled={!textStyle}>
                <option value="Arial">Arial</option>
                <option value="Calibri">Calibri</option>
                <option value="Comic Sans">Comic Sans</option>
                <option value="Open Sans">Open Sans</option>
                <option value="Roboto">Roboto</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Verdana">Verdana</option>
              </SelectItem>
            </Group>
            <Group>
              <SelectItem width={60} value={textStyle ? `${textStyle.size}` : ''} disabled={!textStyle}>
                <option value="" style={{ display: 'hidden' }} />
                <option value="10">10</option>
                <option value="12">12</option>
                <option value="14">14</option>
                <option value="16">16</option>
                <option value="18">18</option>
                <option value="24">24</option>
                <option value="30">30</option>
                <option value="36">36</option>
                <option value="42">42</option>
              </SelectItem>
            </Group>
            <Group>
              <Item
                active={textStyle && textStyle.weight !== null && textStyle.weight > 400 ? true : false}
                disabled={!textStyle}
              >
                <i className="mdi mdi-format-bold" />
              </Item>
              <Item
                active={textStyle && textStyle.italic ? true : false}
                disabled={!textStyle}
              >
                <i className="mdi mdi-format-italic" />
              </Item>
              <Item
                active={textStyle && textStyle.underline ? true : false}
                disabled={!textStyle}
              >
                <i className="mdi mdi-format-underline" />
              </Item>
              <Item
                active={textStyle && textStyle.strikethrough ? true : false}
                disabled={!textStyle}
              >
                <i className="mdi mdi-format-strikethrough-variant" />
              </Item>
              <Item
                active={false}
                disabled={!textStyle}
              >
                <i
                  className="mdi mdi-format-color-text"
                  style={{ position: 'relative', top: '-2px' }}
                />
                <ItemColorLine color={textStyle && textStyle.color !== null ? textStyle.color : 'transparent'} />
              </Item>
            </Group>
          </InnerWrapper>
        </Wrapper>
      </>
    );
  }
};

export default ToolBar;
