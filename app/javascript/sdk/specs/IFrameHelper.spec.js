// EVIRMA: Verify settings and availability at the SDK message boundary.
import Cookies from 'js-cookie';
import { IFrameHelper } from '../IFrameHelper';
// EVIRMA: Exercise the external-token error path through the existing error contract.
import { SET_USER_ERROR } from '../../widget/constants/errorTypes';
// EVIRMA: Exercise public URL validation together with the actual loaded handler.
import { getPageUrl } from '../settingsHelper';
// EVIRMA: Exercise reset and guest login through the real SDK with the loaded handler.
import '../../entrypoints/sdk';

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
    // EVIRMA: Public SDK lifecycle tests supply per-test settings.
    delete window.chatwootSettings;
    messageListeners.forEach(listener =>
      window.removeEventListener('message', listener)
    );
    messageListeners = [];
    vi.restoreAllMocks();
  });

  // EVIRMA: Bootstrap exposes only a boolean URL marker and sends credentials to the trusted frame.
  it.each([false, true])(
    'bootstraps a signed user with external persistence=%s',
    external => {
      const user = {
        identifier: 'customer',
        identifier_hash: 'signed-hash',
        name: 'Customer',
      };
      window.$chatwoot.bootstrapUser = user;
      window.$chatwoot.useExternalConversationToken = external;
      window.$chatwoot.conversationToken = 'external-token';
      const getCookie = vi
        .spyOn(Cookies, 'get')
        .mockReturnValue('cookie-token');
      const url = IFrameHelper.getUrl({
        baseUrl: window.$chatwoot.baseUrl,
        websiteToken: 'website',
      });
      expect(new URL(url).searchParams.get('bootstrap')).toBe('true');
      expect(url).not.toContain('signed-hash');
      expect(url).not.toContain('identifier');
      IFrameHelper.initPostMessageCommunication();
      const data = 'chatwoot-widget:{"event":"bootstrap-request"}';
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          source: iframe.contentWindow,
          origin: 'https://evil.example',
        })
      );
      expect(postMessage).not.toHaveBeenCalled();
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          source: iframe.contentWindow,
          origin: 'https://support.evirma.ru',
        })
      );
      expect(postMessage).toHaveBeenCalledExactlyOnceWith(
        `chatwoot-widget:${JSON.stringify({ event: 'bootstrap', user, conversationToken: external ? 'external-token' : 'cookie-token' })}`,
        'https://support.evirma.ru'
      );
      expect(getCookie).toHaveBeenCalledTimes(external ? 0 : 1);
    }
  );

  // EVIRMA: A completed initial identity publishes its final token without another setUser.
  it('does not identify the bootstrap user a second time after loaded', () => {
    window.$chatwoot.bootstrapUser = {
      identifier: 'customer',
      identifier_hash: 'signed-hash',
    };
    window.$chatwoot.useExternalConversationToken = true;
    vi.spyOn(IFrameHelper, 'onLoad').mockImplementation(() => {});
    vi.spyOn(IFrameHelper, 'toggleCloseButton').mockImplementation(() => {});
    const listener = vi.fn();
    window.addEventListener('chatwoot:conversation-token', listener);
    IFrameHelper.events.loaded({
      config: {
        authToken: 'final-token',
        channelConfig: { widgetColor: '#000' },
      },
    });
    window.removeEventListener('chatwoot:conversation-token', listener);
    expect(listener.mock.calls[0][0].detail).toEqual({ token: 'final-token' });
    expect(
      postMessage.mock.calls.some(([data]) =>
        data.includes('"event":"set-user"')
      )
    ).toBe(false);
  });

  // EVIRMA: Only external-token hosts receive ready again after logging out.
  it.each([
    {},
    { conversationToken: null },
    { conversationToken: 'host-token' },
  ])('reloads as a guest and preserves ready semantics with %j', settings => {
    delete window.$chatwoot;
    window.chatwootSettings = {
      ...settings,
      hideMessageBubble: true,
      user: { identifier: 'customer', name: 'Customer' },
    };
    vi.spyOn(IFrameHelper, 'createFrame').mockImplementation(() => {});
    vi.spyOn(IFrameHelper, 'onLoad').mockImplementation(() => {});
    vi.spyOn(IFrameHelper, 'toggleCloseButton').mockImplementation(() => {});
    window.chatwootSDK.run({
      baseUrl: 'https://support.evirma.ru',
      websiteToken: 'website',
    });
    const ready = vi.fn();
    window.addEventListener('chatwoot:ready', ready);
    const loaded = {
      config: {
        authToken: 'guest-token',
        channelConfig: { widgetColor: '#000' },
      },
    };
    IFrameHelper.events.loaded(loaded);
    expect(ready).toHaveBeenCalledOnce();
    window.$chatwoot.setUser('customer', { name: 'Customer' });

    window.$chatwoot.reset();
    const url = new URL(iframe.src);
    expect(url.searchParams.has('bootstrap')).toBe(false);
    expect(url.searchParams.has('cw_conversation')).toBe(false);
    // EVIRMA: Navigation replaces contentWindow, so observe the reloaded frame.
    postMessage = vi.spyOn(iframe.contentWindow, 'postMessage');
    IFrameHelper.events.loaded(loaded);
    window.removeEventListener('chatwoot:ready', ready);

    const messages = postMessage.mock.calls.map(([data]) =>
      JSON.parse(data.replace('chatwoot-widget:', ''))
    );
    expect(messages.some(({ event }) => event === 'set-user')).toBe(false);
    expect(ready).toHaveBeenCalledTimes(
      'conversationToken' in settings ? 2 : 1
    );
  });

  // EVIRMA: Replay identity set before loaded, including while reset is reloading the frame.
  it.each([false, true])(
    'replays the complete set-user payload on loaded after reset=%s',
    afterReset => {
      delete window.$chatwoot;
      window.chatwootSettings = {
        conversationToken: null,
        hideMessageBubble: true,
      };
      vi.spyOn(IFrameHelper, 'createFrame').mockImplementation(() => {});
      vi.spyOn(IFrameHelper, 'onLoad').mockImplementation(() => {});
      vi.spyOn(IFrameHelper, 'toggleCloseButton').mockImplementation(() => {});
      window.chatwootSDK.run({
        baseUrl: 'https://support.evirma.ru',
        websiteToken: 'website',
      });
      const loaded = {
        config: {
          authToken: 'guest-token',
          channelConfig: { widgetColor: '#000' },
        },
      };
      if (afterReset) {
        IFrameHelper.events.loaded(loaded);
        window.$chatwoot.reset();
        postMessage = vi.spyOn(iframe.contentWindow, 'postMessage');
      }
      const user = {
        identifier_hash: 'signed-hash',
        name: 'Customer',
        email: 'customer@example.com',
      };
      window.$chatwoot.setUser('customer', user);
      postMessage.mockClear();

      IFrameHelper.events.loaded(loaded);

      expect(postMessage).toHaveBeenLastCalledWith(
        `chatwoot-widget:${JSON.stringify({ event: 'set-user', identifier: 'customer', user })}`,
        'https://support.evirma.ru'
      );
    }
  );

  // EVIRMA: Login from the post-reset ready handler keeps the guest conversation token.
  it('identifies a guest after ready with the complete set-user payload', () => {
    delete window.$chatwoot;
    window.chatwootSettings = {
      conversationToken: null,
      hideMessageBubble: true,
    };
    vi.spyOn(IFrameHelper, 'createFrame').mockImplementation(() => {});
    vi.spyOn(IFrameHelper, 'onLoad').mockImplementation(() => {});
    vi.spyOn(IFrameHelper, 'toggleCloseButton').mockImplementation(() => {});
    window.chatwootSDK.run({
      baseUrl: 'https://support.evirma.ru',
      websiteToken: 'website',
    });
    window.$chatwoot.reset();
    // EVIRMA: Observe messages sent to the guest frame created by reset.
    postMessage = vi.spyOn(iframe.contentWindow, 'postMessage');
    const user = {
      identifier_hash: 'signed-hash',
      name: 'Customer',
      email: 'customer@example.com',
    };
    const ready = vi.fn(() => window.$chatwoot.setUser('customer', user));
    window.addEventListener('chatwoot:ready', ready);
    IFrameHelper.events.loaded({
      config: {
        authToken: 'guest-token',
        channelConfig: { widgetColor: '#000' },
      },
    });
    window.removeEventListener('chatwoot:ready', ready);

    expect(ready).toHaveBeenCalledOnce();
    expect(window.$chatwoot.conversationToken).toBe('guest-token');
    expect(postMessage).toHaveBeenLastCalledWith(
      `chatwoot-widget:${JSON.stringify({ event: 'set-user', identifier: 'customer', user })}`,
      'https://support.evirma.ru'
    );
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
      'https://support.evirma.ru'
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
    window.$chatwoot.headerSubtitle = 'Поможем с заказом';
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
      headerSubtitle: 'Поможем с заказом',
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

  // EVIRMA: Outgoing identity messages must target only the configured widget origin.
  it('targets the base URL origin, including its port', () => {
    window.$chatwoot.baseUrl = 'https://support.example:8443/chat';
    IFrameHelper.sendMessage('set-user', { identifier: 'customer' });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(
      'chatwoot-widget:{"event":"set-user","identifier":"customer"}',
      'https://support.example:8443'
    );
  });

  // EVIRMA: External mode must not touch campaign cookies, even when snoozing repeatedly.
  it.each([false, true])(
    'publishes campaign snoozes with external mode=%s',
    external => {
      window.$chatwoot.useExternalConversationToken = external;
      window.$chatwoot.campaignsSnoozedTill = Date.now() + 1000;
      window.$chatwoot.conversationCustomAttributes = { order: '42' };
      const getCookie = vi.spyOn(Cookies, 'get').mockReturnValue('1234');
      const setCookie = vi.spyOn(Cookies, 'set').mockImplementation(() => {});
      const listener = vi.fn();
      window.addEventListener('chatwoot:campaigns-snoozed', listener);
      vi.spyOn(IFrameHelper, 'onLoad').mockImplementation(() => {});
      vi.spyOn(IFrameHelper, 'toggleCloseButton').mockImplementation(() => {});
      IFrameHelper.events.loaded({
        config: { authToken: 'token', channelConfig: { widgetColor: '#000' } },
      });
      expect(
        JSON.parse(postMessage.mock.calls[0][0].replace('chatwoot-widget:', ''))
      ).toMatchObject({
        campaignsSnoozedTill: external
          ? window.$chatwoot.campaignsSnoozedTill
          : '1234',
        conversationCustomAttributes: { order: '42' },
      });
      IFrameHelper.events.setCampaignReadOn();
      IFrameHelper.events.setCampaignReadOn();
      window.removeEventListener('chatwoot:campaigns-snoozed', listener);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[0][0].detail.till).toBeGreaterThan(Date.now());
      expect(window.$chatwoot.campaignsSnoozedTill).toBe(
        listener.mock.calls[1][0].detail.till
      );
      expect(getCookie).toHaveBeenCalledTimes(external ? 0 : 1);
      expect(setCookie).toHaveBeenCalledTimes(external ? 0 : 3);
    }
  );

  // EVIRMA: A hidden launcher still publishes unread changes, including a read receipt.
  it('publishes unread counts when the bubble is hidden', () => {
    window.$chatwoot.hideMessageBubble = true;
    const listener = vi.fn();
    window.addEventListener('chatwoot:unread-count', listener);
    [0, 2, 0].forEach(unreadMessageCount => {
      IFrameHelper.events.handleNotificationDot({ unreadMessageCount });
    });
    window.removeEventListener('chatwoot:unread-count', listener);
    expect(listener.mock.calls.map(([event]) => event.detail)).toEqual([
      { count: 0 },
      { count: 2 },
      { count: 0 },
    ]);
  });

  // EVIRMA: Invalid optional attribution must still send config, reveal the frame and emit ready.
  it('continues loaded initialization after ignoring an invalid page URL', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.$chatwoot.pageUrl = getPageUrl('/orders');
    const ready = vi.fn();
    window.addEventListener('chatwoot:ready', ready);
    const onLoad = vi
      .spyOn(IFrameHelper, 'onLoad')
      .mockImplementation(() => {});
    vi.spyOn(IFrameHelper, 'toggleCloseButton').mockImplementation(() => {});
    IFrameHelper.events.loaded({
      config: { authToken: 'token', channelConfig: { widgetColor: '#000' } },
    });
    window.removeEventListener('chatwoot:ready', ready);
    expect(postMessage).toHaveBeenCalledWith(
      expect.stringContaining('"event":"config-set"'),
      'https://support.evirma.ru'
    );
    expect(onLoad).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledOnce();
  });
});
