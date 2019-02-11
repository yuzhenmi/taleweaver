import DocumentView from './DocumentView';
import PageView from './PageView';
import LineView from './LineView';
import WordView from './WordView';

interface ViewAwarePosition {
  documentView: DocumentView;
  documentViewPosition: number;
  pageView: PageView;
  pageViewPosition: number;
  lineView: LineView;
  lineViewPosition: number;
  wordView: WordView;
  wordViewPosition: number;
}

export default ViewAwarePosition;
