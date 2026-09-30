// @vitest-environment jsdom
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { blockFilePickers } from '../src/preview/filePickers.ts';

const nativeClick = HTMLInputElement.prototype.click;

afterEach(() => {
  HTMLInputElement.prototype.click = nativeClick;
  document.body.innerHTML = '';
});

describe('blockFilePickers', () => {
  it('keeps a dropzone that clicks its file input from opening the file picker, and upload still works', async () => {
    // Stands in for the browser opening the file picker
    const openPicker = vi.fn();
    HTMLInputElement.prototype.click = function (this: HTMLInputElement) {
      if (this.type === 'file') {
        openPicker();
      }
      nativeClick.call(this);
    };
    document.body.innerHTML = '<div id="dropzone"><input type="file" /></div>';
    const input = document.querySelector('input')!;
    let clicking = false;
    // Like Aksel's FileUpload.Dropzone: onClick: () => inputRef.current?.click()
    document.getElementById('dropzone')!.addEventListener('click', () => {
      if (!clicking) {
        clicking = true;
        input.click();
        clicking = false;
      }
    });
    const file = new File(['content'], 'file.txt');

    const restore = blockFilePickers();
    await userEvent.upload(input, file);
    restore();

    expect(openPicker).not.toHaveBeenCalled();
    expect(input.files?.[0]).toBe(file);

    input.click();
    expect(openPicker).toHaveBeenCalled();
  });

  it('lets click() through on other inputs', () => {
    document.body.innerHTML = '<input type="checkbox" />';
    const checkbox = document.querySelector('input')!;

    const restore = blockFilePickers();
    checkbox.click();
    restore();

    expect(checkbox.checked).toBe(true);
  });
});
