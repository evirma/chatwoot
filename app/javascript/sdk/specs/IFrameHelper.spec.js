// EVIRMA: Verify settings and availability at the SDK message boundary.
import { IFrameHelper } from '../IFrameHelper';

describe('IFrameHelper EVIRMA messages', () => {
  let iframe;
  let postMessage;

  beforeEach(() => {
    iframe = document.createElement('iframe');
    iframe.id = 'chatwoot_live_chat_widget';
    document.body.appendChild(iframe);
    postMessage = vi.spyOn(iframe.contentWindow, 'postMessage');
    window.$chatwoot = {};
  });

  afterEach(() => {
    iframe.remove();
    delete window.$chatwoot;
    window.onmessage = null;
    vi.restoreAllMocks();
  });

  it.each([false, true])('sends hideHeader=%s in config-set', hideHeader => {
    window.$chatwoot.hideHeader = hideHeader;
    vi.spyOn(IFrameHelper, 'onLoad').mockImplementation(() => {});
    vi.spyOn(IFrameHelper, 'toggleCloseButton').mockImplementation(() => {});

    IFrameHelper.events.loaded({
      config: { authToken: 'token', channelConfig: { widgetColor: '#000000' } },
    });

    expect(postMessage).toHaveBeenCalledWith(
      expect.stringContaining(`"hideHeader":${hideHeader}`),
      '*'
    );
    const message = JSON.parse(
      postMessage.mock.calls[0][0].replace('chatwoot-widget:', '')
    );
    expect(message).toMatchObject({ event: 'config-set', hideHeader });
  });

  // EVIRMA: Pass the host's home-screen preference to the iframe.
  it.each([false, true])('sends skipHome=%s in config-set', skipHome => {
    window.$chatwoot.skipHome = skipHome;
    vi.spyOn(IFrameHelper, 'onLoad').mockImplementation(() => {});
    vi.spyOn(IFrameHelper, 'toggleCloseButton').mockImplementation(() => {});

    IFrameHelper.events.loaded({
      config: { authToken: 'token', channelConfig: { widgetColor: '#000000' } },
    });

    const message = JSON.parse(
      postMessage.mock.calls[0][0].replace('chatwoot-widget:', '')
    );
    expect(message).toMatchObject({ event: 'config-set', skipHome });
  });

  // EVIRMA: Forward the widget event using the SDK's window event convention.
  it.each([false, true])(
    'dispatches availability isOnline=%s to the host',
    isOnline => {
      const listener = vi.fn();
      window.addEventListener('chatwoot:availability-changed', listener);
      IFrameHelper.initPostMessageCommunication();

      // EVIRMA: Vitest stores onmessage separately from jsdom event dispatch.
      window.onmessage(
        new MessageEvent('message', {
          data: `chatwoot-widget:${JSON.stringify({ event: 'availability-changed', isOnline })}`,
        })
      );
      window.removeEventListener('chatwoot:availability-changed', listener);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].detail).toEqual({ isOnline });
    }
  );
});
