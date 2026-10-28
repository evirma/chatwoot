import { API, setHeader } from 'widget/helpers/axios';
import { sendMessage } from 'widget/helpers/utils';
import ActionCableConnector from 'widget/helpers/actionCable';
import { actions } from '../../contacts';

const commit = vi.fn();
const dispatch = vi.fn();

vi.mock('widget/helpers/axios');
vi.mock('widget/helpers/utils', () => ({
  sendMessage: vi.fn(),
}));
vi.mock('widget/helpers/actionCable', () => ({
  default: { refreshConnector: vi.fn() },
}));

describe('#actions', () => {
  let initialAuthToken;
  let initialPubsubToken;

  beforeEach(() => {
    initialAuthToken = window.authToken;
    initialPubsubToken = window.chatwootPubsubToken;
  });

  afterEach(() => {
    if (initialAuthToken === undefined) delete window.authToken;
    else window.authToken = initialAuthToken;
    if (initialPubsubToken === undefined) delete window.chatwootPubsubToken;
    else window.chatwootPubsubToken = initialPubsubToken;
  });

  describe('#setUser', () => {
    // EVIRMA: A signed identity replaces both guest credentials before fetching history.
    it('installs the rotated HTTP and websocket tokens', async () => {
      vi.spyOn(API, 'patch').mockResolvedValue({
        data: { widget_auth_token: 'new-jwt', pubsub_token: 'new-pubsub' },
      });

      await actions.setUser(
        { commit, dispatch },
        { identifier: 'customer', user: { identifier_hash: 'signature' } }
      );

      expect(window.authToken).toBe('new-jwt');
      expect(setHeader).toHaveBeenCalledWith('new-jwt');
      expect(sendMessage).toHaveBeenCalledWith({
        event: 'setAuthCookie',
        data: { widgetAuthToken: 'new-jwt' },
      });
      expect(ActionCableConnector.refreshConnector).toHaveBeenCalledWith(
        'new-pubsub'
      );
    });

    it('sends correct actions if contact object is refreshed ', async () => {
      const user = {
        email: 'thoma@sphadikam.com',
        name: 'Adu Thoma',
        avatar_url: '',
      };
      vi.spyOn(API, 'patch').mockResolvedValue({
        data: { widget_auth_token: 'token' },
      });
      await actions.setUser({ commit, dispatch }, { identifier: 1, user });
      expect(sendMessage.mock.calls).toEqual([
        [{ data: { widgetAuthToken: 'token' }, event: 'setAuthCookie' }],
      ]);
      expect(commit.mock.calls).toEqual([]);
      expect(dispatch.mock.calls).toEqual([
        // EVIRMA: Identification resets previous history before fetching with the new token.
        ['contactHistory/reset', null, { root: true }],
        ['contactHistory/fetch', null, { root: true }],
        ['get'],
        ['conversation/clearConversations', {}, { root: true }],
        ['conversation/fetchOldConversations', {}, { root: true }],
        ['conversationAttributes/getAttributes', {}, { root: true }],
      ]);
    });

    it('sends correct actions if identifierHash is passed ', async () => {
      const user = {
        email: 'thoma@sphadikam.com',
        name: 'Adu Thoma',
        avatar_url: '',
        identifier_hash: '12345',
      };
      vi.spyOn(API, 'patch').mockResolvedValue({ data: { id: 1 } });
      await actions.setUser({ commit, dispatch }, { identifier: 1, user });
      expect(sendMessage.mock.calls).toEqual([]);
      expect(ActionCableConnector.refreshConnector).not.toHaveBeenCalled();
      expect(commit.mock.calls).toEqual([]);
      expect(dispatch.mock.calls).toEqual([
        // EVIRMA: History refresh also follows identification with an existing token.
        ['contactHistory/reset', null, { root: true }],
        ['contactHistory/fetch', null, { root: true }],
        ['get'],
        ['conversation/clearConversations', {}, { root: true }],
        ['conversation/fetchOldConversations', {}, { root: true }],
        ['conversationAttributes/getAttributes', {}, { root: true }],
      ]);
    });

    it('does not call sendMessage if contact object is not refreshed ', async () => {
      const user = {
        email: 'thoma@sphadikam.com',
        name: 'Adu Thoma',
        avatar_url: '',
      };
      API.patch.mockResolvedValue({ data: { id: 1 } });
      await actions.setUser({ commit, dispatch }, { identifier: 1, user });
      expect(sendMessage.mock.calls).toEqual([]);
      expect(ActionCableConnector.refreshConnector).not.toHaveBeenCalled();
      expect(commit.mock.calls).toEqual([]);
      // EVIRMA: An unchanged contact token can still gain an identifier and history access.
      expect(dispatch.mock.calls).toEqual([
        ['contactHistory/reset', null, { root: true }],
        ['contactHistory/fetch', null, { root: true }],
        ['get'],
      ]);
    });

    it('keeps both credentials after a failed identification', async () => {
      window.authToken = 'guest-jwt';
      window.chatwootPubsubToken = 'guest-pubsub';
      API.patch.mockRejectedValueOnce({
        response: { data: { error: 'invalid' } },
      });

      await actions.setUser(
        { commit, dispatch },
        { identifier: 'customer', user: { identifier_hash: 'signature' } }
      );

      expect(window.authToken).toBe('guest-jwt');
      expect(window.chatwootPubsubToken).toBe('guest-pubsub');
      expect(ActionCableConnector.refreshConnector).not.toHaveBeenCalled();
    });
  });

  describe('#update', () => {
    it('sends correct actions', async () => {
      const user = {
        email: 'thoma@sphadikam.com',
        name: 'Adu Thoma',
        avatar_url: '',
        identifier_hash: 'random_hex_identifier_hash',
      };
      API.patch.mockResolvedValue({ data: { id: 1 } });
      await actions.update({ commit, dispatch }, { identifier: 1, user });
      expect(commit.mock.calls).toEqual([]);
      expect(dispatch.mock.calls).toEqual([['get']]);
    });
  });
});
