/** Style properties relevant to layout. */
export interface RenderStyles {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly fontWeight?: string;
  readonly fontStyle?: string;
  readonly textDecoration?: string;
  /** Line height as a multiplier of fontSize (e.g. 1.5 means fontSize * 1.5). */
  readonly lineHeight?: number;
  /** Top line margin as a ratio of the resolved line height (lineHeight * fontSize px). */
  readonly lineMarginTop?: number;
  /** Bottom line margin as a ratio of the resolved line height (lineHeight * fontSize px). */
  readonly lineMarginBottom?: number;
  /** Top block margin as a ratio of the resolved line height — minimum inter-block gap. */
  readonly blockMarginTop?: number;
  /** Bottom block margin as a ratio of the resolved line height — minimum inter-block gap. */
  readonly blockMarginBottom?: number;
  readonly paddingTop?: number;
  readonly paddingBottom?: number;
  readonly paddingLeft?: number;
  readonly paddingRight?: number;
}
