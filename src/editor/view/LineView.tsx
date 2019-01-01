import React from 'react';
import LineLayout from '../layout/LineLayout';
import viewRegistry from './util/viewRegistry';

type LineViewProps = {
  lineLayout: LineLayout;
};
export default class LineView extends React.Component<LineViewProps> {
  render() {
    const {
      lineLayout,
    } = this.props;
    return (
      <div className="tw--line" data-tw-role="line">
        {lineLayout.getBoxLayouts().map((boxLayout, boxLayoutIndex) => {
          const BoxView = viewRegistry.getBoxView(boxLayout.getType());
          if (!BoxView) {
            return null;
          }
          return (
            <BoxView key={boxLayoutIndex} boxLayout={boxLayout} />
          );
        })}
      </div>
    );
  }
}
