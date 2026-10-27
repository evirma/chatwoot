import Cookies from 'js-cookie';
import { IFrameHelper } from '../sdk/IFrameHelper';
import './sdk';

vi.mock('../sdk/IFrameHelper', () => ({
  IFrameHelper: {
    createFrame: vi.fn(),
    sendMessage: vi.fn(),
    // EVIRMA: Observe public reset and page updates at the existing iframe boundary.
    events: { onLocationChange: vi.fn(), toggleBubble: vi.fn() },
    getAppFrame: vi.fn(() => ({ src: '' })),
    getUrl: vi.fn(
      () => 'https://support.evirma.ru/widget?website_token=website-token'
    ),
  },
}));

describe('$chatwoot.setUser', () => {
  beforeEach(() => {
    delete window.$chatwoot;
    window.chatwootSettings = {};
    vi.spyOn(Cookies, 'get').mockReturnValue(undefined);
    vi.spyOn(Cookies, 'set').mockImplementation(() => {});

    window.chatwootSDK.run({
      baseUrl: 'https://app.chatwoot.com',
      websiteToken: 'website-token',
    });
  });

  afterEach(() => {
    delete window.$chatwoot;
    delete window.chatwootSettings;
    vi.restoreAllMocks();
  });

  it('updates the SDK identity synchronously', () => {
    const user = { name: 'Pranav' };

    const result = window.$chatwoot.setUser('first-user', user);

    expect(result).toBeUndefined();
    expect(window.$chatwoot.identifier).toBe('first-user');
    expect(window.$chatwoot.user).toBe(user);
    expect(IFrameHelper.sendMessage).toHaveBeenCalledWith('set-user', {
      identifier: 'first-user',
      user,
    });
  });

  it('keeps the latest identity after consecutive calls', () => {
    const firstUser = { name: 'First user' };
    const secondUser = { name: 'Second user' };

    window.$chatwoot.setUser('first-user', firstUser);
    window.$chatwoot.setUser('second-user', secondUser);

    expect(window.$chatwoot.identifier).toBe('second-user');
    expect(window.$chatwoot.user).toBe(secondUser);
    expect(IFrameHelper.sendMessage).toHaveBeenLastCalledWith('set-user', {
      identifier: 'second-user',
      user: secondUser,
    });
  });

  // EVIRMA: Logout must clear every identity that could be replayed after iframe reload.
  it('clears the current and bootstrap identities on reset', () => {
    window.$chatwoot.bootstrapUser = { identifier: 'bootstrap-user' };
    window.$chatwoot.conversationToken = 'user-token';
    window.$chatwoot.setUser('customer', { name: 'Customer' });

    window.$chatwoot.reset();

    expect(window.$chatwoot.user).toBeNull();
    expect(window.$chatwoot.identifier).toBeNull();
    expect(window.$chatwoot.bootstrapUser).toBeNull();
    expect(window.$chatwoot.conversationToken).toBeNull();
  });
});

// EVIRMA: Verify the host setting reaches the SDK configuration.
describe('$chatwoot.hideHeader', () => {
  afterEach(() => {
    delete window.$chatwoot;
    delete window.chatwootSettings;
  });

  it.each([undefined, false, true])('reads hideHeader=%s', hideHeader => {
    delete window.$chatwoot;
    window.chatwootSettings = { hideHeader };

    window.chatwootSDK.run({
      baseUrl: 'https://app.chatwoot.com',
      websiteToken: 'website-token',
    });

    expect(window.$chatwoot.hideHeader).toBe(hideHeader === true);
  });
});

// EVIRMA: Keep the home screen opt-out disabled unless explicitly enabled.
describe('$chatwoot.skipHome', () => {
  afterEach(() => {
    delete window.$chatwoot;
    delete window.chatwootSettings;
  });

  it.each([undefined, false, true])('reads skipHome=%s', skipHome => {
    delete window.$chatwoot;
    window.chatwootSettings = { skipHome };

    window.chatwootSDK.run({
      baseUrl: 'https://app.chatwoot.com',
      websiteToken: 'website-token',
    });

    expect(window.$chatwoot.skipHome).toBe(skipHome === true);
  });
});

// EVIRMA: External persistence and page attribution are configured through the public SDK.
describe('$chatwoot external host configuration', () => {
  // EVIRMA: Initial identity travels through bootstrap instead of a second setUser after ready.
  it('retains the signed bootstrap user when the SDK runs', () => {
    const user = {
      identifier: 'customer',
      identifier_hash: 'signed-hash',
      name: 'Customer',
      email: 'customer@example.com',
    };
    window.chatwootSettings = { user, conversationToken: null };
    window.chatwootSDK.run({
      baseUrl: 'https://support.evirma.ru',
      websiteToken: 'website',
    });
    expect(window.$chatwoot.bootstrapUser).toEqual(user);
    expect(window.$chatwoot.user).toBeUndefined();
    window.$chatwoot.reset();
    expect(window.$chatwoot.bootstrapUser).toBeNull();
  });

  afterEach(() => {
    delete window.$chatwoot;
    delete window.chatwootSettings;
    vi.restoreAllMocks();
  });

  it.each([null, 'host-token'])(
    'never reads or writes identity cookies with conversationToken=%s',
    conversationToken => {
      window.chatwootSettings = { conversationToken };
      const getCookie = vi.spyOn(Cookies, 'get');
      const setCookie = vi.spyOn(Cookies, 'set');
      // EVIRMA: Reset and subsequent login must leave external-mode cookies untouched.
      const removeCookie = vi.spyOn(Cookies, 'remove');
      window.chatwootSDK.run({
        baseUrl: 'https://support.evirma.ru',
        websiteToken: 'website-token',
      });
      window.$chatwoot.setUser('customer', { name: 'Customer' });
      // EVIRMA: Repeated external identification must still reach the server.
      window.$chatwoot.setUser('customer', { name: 'Customer' });
      expect(
        IFrameHelper.sendMessage.mock.calls.filter(
          ([event]) => event === 'set-user'
        )
      ).toHaveLength(2);
      expect(window.$chatwoot.useExternalConversationToken).toBe(true);
      expect(window.$chatwoot.conversationToken).toBe(conversationToken);
      // EVIRMA: A new login after logout still uses the cookie-free setUser path.
      window.$chatwoot.reset();
      expect(window.$chatwoot.conversationToken).toBeNull();
      window.$chatwoot.setUser('next-customer', { name: 'Next customer' });
      expect(getCookie).not.toHaveBeenCalled();
      expect(setCookie).not.toHaveBeenCalled();
      expect(removeCookie).not.toHaveBeenCalled();
    }
  );

  it.each([{}, { conversationToken: 'host-token' }])(
    'publishes a null token when reset with %j',
    settings => {
      window.chatwootSettings = settings;
      window.chatwootSDK.run({
        baseUrl: 'https://support.evirma.ru',
        websiteToken: 'website-token',
      });
      const removeCookie = vi
        .spyOn(Cookies, 'remove')
        .mockImplementation(() => {});
      const listener = vi.fn();
      window.addEventListener('chatwoot:conversation-token', listener);
      window.$chatwoot.reset();
      window.removeEventListener('chatwoot:conversation-token', listener);
      expect(listener.mock.calls[0][0].detail).toEqual({ token: null });
      expect(removeCookie).toHaveBeenCalledTimes(
        'conversationToken' in settings ? 0 : 2
      );
      expect(window.$chatwoot.conversationToken).toBeNull();
    }
  );

  it('retains page and messenger settings and immediately sends page updates', () => {
    window.chatwootSettings = {
      pageUrl: 'https://market.example/products',
      messengerButtons: ['telegram', 'max'],
      headerSubtitle: 'Поможем с заказом',
    };
    window.chatwootSDK.run({
      baseUrl: 'https://support.evirma.ru',
      websiteToken: 'website-token',
    });
    expect(window.$chatwoot.pageUrl).toBe('https://market.example/products');
    expect(window.$chatwoot.messengerButtons).toEqual(['telegram', 'max']);
    // EVIRMA: Preserve the optional header copy for config-set delivery.
    expect(window.$chatwoot.headerSubtitle).toBe('Поможем с заказом');
    window.$chatwoot.setPageUrl('https://market.example/orders');
    expect(window.$chatwoot.pageUrl).toBe('https://market.example/orders');
    expect(IFrameHelper.events.onLocationChange).toHaveBeenCalledWith({});
  });

  it('keeps cookie persistence and messenger buttons disabled by default', () => {
    window.chatwootSDK.run({
      baseUrl: 'https://support.evirma.ru',
      websiteToken: 'website-token',
    });
    expect(window.$chatwoot.useExternalConversationToken).toBe(false);
    expect(window.$chatwoot.messengerButtons).toEqual([]);
    expect(window.$chatwoot.headerSubtitle).toBe('');
  });

  // EVIRMA: Invalid host page URLs cannot break widget initialization or replace valid attribution.
  it.each(['/orders', 'not a URL', '', null, 42])(
    'ignores invalid pageUrl=%s',
    pageUrl => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      window.chatwootSettings = { pageUrl };
      window.chatwootSDK.run({
        baseUrl: 'https://support.evirma.ru',
        websiteToken: 'website',
      });
      expect(window.$chatwoot.pageUrl).toBeUndefined();
      expect(IFrameHelper.createFrame).toHaveBeenCalled();
      window.$chatwoot.setPageUrl('https://market.example/orders');
      IFrameHelper.events.onLocationChange.mockClear();
      window.$chatwoot.setPageUrl(pageUrl);
      expect(window.$chatwoot.pageUrl).toBe('https://market.example/orders');
      expect(IFrameHelper.events.onLocationChange).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(2);
    }
  );

  // EVIRMA: Creation metadata and external campaign persistence survive SDK setup.
  it('retains creation attributes and campaign snooze settings', () => {
    window.chatwootSettings = {
      conversationToken: null,
      campaignsSnoozedTill: 1234567890,
      conversationCustomAttributes: { order: '42' },
    };
    window.chatwootSDK.run({
      baseUrl: 'https://support.evirma.ru',
      websiteToken: 'website',
    });
    expect(window.$chatwoot.campaignsSnoozedTill).toBe(1234567890);
    expect(window.$chatwoot.conversationCustomAttributes).toEqual({
      order: '42',
    });
  });
});
