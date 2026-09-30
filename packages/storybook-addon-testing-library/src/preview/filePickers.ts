/**
 * Components often open the file picker with a real input.click(), for example a dropzone that clicks its hidden
 * <input type="file"> when it is clicked. userEvent.upload() clicks the input, the click bubbles up to the dropzone,
 * and Chrome opens the file picker in the middle of the test run. jsdom never opens one, so this never shows in Vitest.
 * While tests run, click() and showPicker() on a file input do nothing. userEvent.upload() uses neither: it picks the
 * files itself on user-event's internal fileDialog event.
 */

/** Returns a function that removes the shim */
export const blockFilePickers = () => {
  const prototype = HTMLInputElement.prototype;
  const nativeClick = prototype.click;
  const nativeShowPicker = prototype.showPicker;

  prototype.click = function (this: HTMLInputElement) {
    if (this.type !== 'file') {
      nativeClick.call(this);
    }
  };

  // Older browsers and jsdom have no showPicker, and should not get one
  if (nativeShowPicker) {
    prototype.showPicker = function (this: HTMLInputElement) {
      if (this.type !== 'file') {
        nativeShowPicker.call(this);
      }
    };
  }

  return () => {
    prototype.click = nativeClick;
    if (nativeShowPicker) {
      prototype.showPicker = nativeShowPicker;
    }
  };
};
