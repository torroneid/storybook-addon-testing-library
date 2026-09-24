/**
 * Chrome fires no focus or blur events in a window that does not have focus, for example while you type in your
 * editor next to Storybook as the tests run. user-event sets up typing for an input when it gets focus, so without
 * the event, typing never reaches React. While tests run, focus() and blur() in such a window dispatch the events
 * themselves.
 */

const dispatchFocus = (target: Element, type: 'focus' | 'blur', related: Element | null) => {
  const relatedTarget = related === document.body ? null : related;
  target.dispatchEvent(new FocusEvent(type, { relatedTarget }));
  target.dispatchEvent(new FocusEvent(type === 'focus' ? 'focusin' : 'focusout', { bubbles: true, relatedTarget }));
};

/** Returns a function that removes the shim */
export const dispatchFocusEventsWithoutWindowFocus = () => {
  const prototype = HTMLElement.prototype;
  const nativeFocus = prototype.focus;
  const nativeBlur = prototype.blur;

  prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    const previous = document.activeElement;
    nativeFocus.call(this, options);
    if (!document.hasFocus() && previous !== this && document.activeElement === this) {
      if (previous && previous !== document.body) {
        dispatchFocus(previous, 'blur', this);
      }
      dispatchFocus(this, 'focus', previous);
    }
  };

  prototype.blur = function (this: HTMLElement) {
    const wasActive = document.activeElement === this;
    nativeBlur.call(this);
    if (!document.hasFocus() && wasActive && document.activeElement !== this) {
      dispatchFocus(this, 'blur', null);
    }
  };

  return () => {
    prototype.focus = nativeFocus;
    prototype.blur = nativeBlur;
  };
};
