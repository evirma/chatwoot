import { BUBBLE_DESIGN, DARK_MODE, WIDGET_DESIGN } from './constants';

export const getBubbleView = type =>
  BUBBLE_DESIGN.includes(type) ? type : BUBBLE_DESIGN[0];

export const isExpandedView = type => getBubbleView(type) === BUBBLE_DESIGN[1];

export const getWidgetStyle = style =>
  WIDGET_DESIGN.includes(style) ? style : WIDGET_DESIGN[0];

export const isFlatWidgetStyle = style => style === 'flat';

export const getDarkMode = darkMode =>
  DARK_MODE.includes(darkMode) ? darkMode : DARK_MODE[0];

// EVIRMA: Reject invalid host attribution before it can interrupt widget loading.
export const getPageUrl = url => {
  try {
    if (typeof url === 'string') {
      return new URL(url).href;
    }
  } catch {
    // EVIRMA: Invalid optional attribution must leave the existing page unchanged.
  }
  // EVIRMA: Warn at the public input boundary while allowing widget initialization to continue.
  // eslint-disable-next-line no-console
  console.warn('Chatwoot: pageUrl must be an absolute URL');
  return undefined;
};
