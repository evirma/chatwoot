// EVIRMA: Verify settings and availability at the SDK message boundary.
import Cookies from 'js-cookie';
import { IFrameHelper } from '../IFrameHelper';
// EVIRMA: Exercise the external-token error path through the existing error contract.
import { SET_USER_ERROR } from '../../widget/constants/errorTypes';

describe('IFrameHelper EVIRMA messages', () => {
  let iframe;
  let postMessage;
  let messageListeners = [];

  beforeEach(() => {
    iframe = document.createElement('iframe');
    iframe.id = 'chatwoot_live_chat_widget';
    document.body.appendChild(iframe);
    postMessage = vi.spyOn(iframe.contentWindow, 'postMessage');
    window.$chatwoot = { baseUrl: 'https://support.evirma.ru' };
    const addEventListener = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation(
      (type, listener, options) => {
        addEventListener(type, listener, options);
        if (type === 'message') messageListeners.push(listener);
      }
    );
  });

  afterEach(() => {
    iframe.remove();
    delete window.$chatwoot;
    messageListeners.forEach(listener =>
      window.removeEventListener('message', listener)
    );
    messageListeners = [];
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
      const detail = { isOnline, isOutOfOffice: !isOnline, opensAt: '09:00' };
      window.addEventListener('chatwoot:availability-changed', listener);
      IFrameHelper.initPostMessageCommunication();

      // EVIRMA: Exercise the trusted browser message boundary.
      window.dispatchEvent(
        new MessageEvent('message', {
          data: `chatwoot-widget:${JSON.stringify({ event: 'availability-changed', ...detail })}`,
          source: iframe.contentWindow,
          origin: 'https://support.evirma.ru',
        })
      );
      window.removeEventListener('chatwoot:availability-changed', listener);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].detail).toEqual(detail);
    }
  );
  // EVIRMA: Reject messages from foreign windows or origins without replacing host handlers.
  it.each([
    ['https://evil.example', true],
    ['https://support.evirma.ru', false],
  ])('rejects origin=%s and trusted source=%s', (origin, trustedSource) => {
    const listener = vi.fn();
    const hostHandler = vi.fn();
    window.onmessage = hostHandler;
    window.addEventListener('chatwoot:messenger-requested', listener);
    IFrameHelper.initPostMessageCommunication();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin,
        source: trustedSource ? iframe.contentWindow : window,
        data: 'chatwoot-widget:{"event":"messenger-requested","channel":"telegram"}',
      })
    );
    window.removeEventListener('chatwoot:messenger-requested', listener);
    expect(listener).not.toHaveBeenCalled();
    expect(window.onmessage).toBe(hostHandler);
    window.onmessage = null;
  });

  // EVIRMA: A trusted messenger request reaches the host without an API call.
  it.each(['telegram', 'max'])('forwards %s requests', channel => {
    const listener = vi.fn();
    window.addEventListener('chatwoot:messenger-requested', listener);
    IFrameHelper.initPostMessageCommunication();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://support.evirma.ru',
        source: iframe.contentWindow,
        data: `chatwoot-widget:${JSON.stringify({ event: 'messenger-requested', channel })}`,
      })
    );
    window.removeEventListener('chatwoot:messenger-requested', listener);
    expect(listener.mock.calls[0][0].detail).toEqual({ channel });
  });

  // EVIRMA: Token rotation is observable in both cookie and external persistence modes.
  it.each([false, true])('publishes tokens with external mode=%s', external => {
    window.$chatwoot.useExternalConversationToken = external;
    const setCookie = vi.spyOn(Cookies, 'set').mockImplementation(() => {});
    const listener = vi.fn();
    window.addEventListener('chatwoot:conversation-token', listener);
    vi.spyOn(IFrameHelper, 'onLoad').mockImplementation(() => {});
    vi.spyOn(IFrameHelper, 'toggleCloseButton').mockImplementation(() => {});
    IFrameHelper.events.loaded({
      config: { authToken: 'initial', channelConfig: { widgetColor: '#000' } },
    });
    IFrameHelper.events.setAuthCookie({ data: { widgetAuthToken: 'rotated' } });
    window.removeEventListener('chatwoot:conversation-token', listener);
    expect(listener.mock.calls.map(([event]) => event.detail)).toEqual([
      { token: 'initial' },
      { token: 'rotated' },
    ]);
    expect(setCookie).toHaveBeenCalledTimes(external ? 0 : 2);
    expect(window.$chatwoot.conversationToken).toBe('rotated');
  });

  // EVIRMA: Config-set and later navigation carry the actual host page and messenger settings.
  it('uses pageUrl for initial configuration and navigation', () => {
    window.$chatwoot.pageUrl = 'https://market.example:8443/orders/42';
    window.$chatwoot.messengerButtons = ['telegram', 'max'];
    vi.spyOn(IFrameHelper, 'onLoad').mockImplementation(() => {});
    vi.spyOn(IFrameHelper, 'toggleCloseButton').mockImplementation(() => {});
    IFrameHelper.events.loaded({
      config: { authToken: 'token', channelConfig: { widgetColor: '#000' } },
    });
    IFrameHelper.events.onLocationChange({
      referrerURL: 'chrome-extension://test/panel',
      referrerHost: 'test',
    });
    const messages = postMessage.mock.calls.map(([data]) =>
      JSON.parse(data.replace('chatwoot-widget:', ''))
    );
    expect(messages[0]).toMatchObject({
      event: 'config-set',
      messengerButtons: ['telegram', 'max'],
      referrerURL: 'https://market.example:8443/orders/42',
      referrerHost: 'market.example:8443',
    });
    expect(messages[1]).toMatchObject({
      event: 'change-url',
      referrerURL: 'https://market.example:8443/orders/42',
      referrerHost: 'market.example:8443',
    });
  });

  // EVIRMA: Explicit null and string tokens override any existing conversation cookie.
  it.each([null, '', 'external+token/='])(
    'creates an iframe with external token %s',
    token => {
      iframe.remove();
      window.$chatwoot.useExternalConversationToken = true;
      window.$chatwoot.conversationToken = token;
      const getCookie = vi
        .spyOn(Cookies, 'get')
        .mockReturnValue('stale-cookie');
      vi.spyOn(IFrameHelper, 'initPostMessageCommunication').mockImplementation(
        () => {}
      );
      IFrameHelper.createFrame({
        baseUrl: 'https://support.evirma.ru',
        websiteToken: 'website',
      });
      iframe = IFrameHelper.getAppFrame();
      expect(new URL(iframe.src).searchParams.get('cw_conversation')).toBe(
        token
      );
      expect(getCookie).not.toHaveBeenCalled();
      document.getElementById('cw-widget-holder').remove();
      document.getElementById('cw-widget-styles')?.remove();
    }
  );
  // EVIRMA: Existing website installs keep restoring conversations from their cookie.
  it('restores the conversation cookie when external persistence is absent', () => {
    iframe.remove();
    const getCookie = vi
      .spyOn(Cookies, 'get')
      .mockReturnValue('website-cookie');
    vi.spyOn(IFrameHelper, 'initPostMessageCommunication').mockImplementation(
      () => {}
    );
    IFrameHelper.createFrame({
      baseUrl: 'https://support.evirma.ru',
      websiteToken: 'website',
    });
    iframe = IFrameHelper.getAppFrame();
    expect(new URL(iframe.src).searchParams.get('cw_conversation')).toBe(
      'website-cookie'
    );
    expect(getCookie).toHaveBeenCalledExactlyOnceWith('cw_conversation');
    document.getElementById('cw-widget-holder').remove();
    document.getElementById('cw-widget-styles')?.remove();
  });

  // EVIRMA: Popout and identity errors must not consult or clear SDK identity cookies in external mode.
  it('uses the external token in popouts and leaves cookies alone on identity errors', () => {
    window.$chatwoot.useExternalConversationToken = true;
    window.$chatwoot.conversationToken = 'host-token';
    window.$chatwoot.toggle = vi.fn();
    const getCookie = vi.spyOn(Cookies, 'get');
    const removeCookie = vi.spyOn(Cookies, 'remove');
    const focus = vi.fn();
    const openWindow = vi.spyOn(window, 'open').mockReturnValue({ focus });
    IFrameHelper.events.popoutChatWindow({
      baseUrl: 'https://support.evirma.ru',
      websiteToken: 'website',
      locale: 'en',
    });
    IFrameHelper.events.error({ errorType: SET_USER_ERROR, data: {} });
    expect(
      new URL(openWindow.mock.calls[0][0]).searchParams.get('cw_conversation')
    ).toBe('host-token');
    expect(focus).toHaveBeenCalledOnce();
    expect(getCookie).not.toHaveBeenCalled();
    expect(removeCookie).not.toHaveBeenCalled();
  });

  // EVIRMA: No external page means the existing website attribution remains unchanged.
  it('preserves website attribution when pageUrl is absent', () => {
    vi.spyOn(IFrameHelper, 'onLoad').mockImplementation(() => {});
    vi.spyOn(IFrameHelper, 'toggleCloseButton').mockImplementation(() => {});
    IFrameHelper.events.loaded({
      config: { authToken: 'token', channelConfig: { widgetColor: '#000' } },
    });
    IFrameHelper.events.onLocationChange({
      referrerURL: 'https://site.example/page',
      referrerHost: 'site.example',
    });
    const messages = postMessage.mock.calls.map(([data]) =>
      JSON.parse(data.replace('chatwoot-widget:', ''))
    );
    expect(messages[0]).not.toHaveProperty('referrerURL');
    expect(messages[0]).not.toHaveProperty('referrerHost');
    expect(messages[1]).toEqual({
      event: 'change-url',
      referrerURL: 'https://site.example/page',
      referrerHost: 'site.example',
    });
  });
});
