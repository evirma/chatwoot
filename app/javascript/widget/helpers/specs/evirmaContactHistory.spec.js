// EVIRMA: Deliver cross-channel replies to the parent without touching the active conversation.
import ActionCableConnector from '../actionCable';
import { IFrameHelper } from '../utils';
import { CHATWOOT_ON_MESSAGE } from '../../constants/sdkEvents';

vi.mock('@rails/actioncable', () => ({
  createConsumer: () => ({
    subscriptions: { create: () => ({}) },
    disconnect: vi.fn(),
  }),
}));

describe('contact history events', () => {
  let dispatch;
  let connector;
  let sendMessage;

  beforeEach(() => {
    vi.useFakeTimers();
    dispatch = vi.fn().mockResolvedValue();
    connector = new ActionCableConnector(
      {
        $store: {
          dispatch,
          getters: { 'conversationAttributes/getConversationParams': {} },
        },
      },
      'contact-token'
    );
    sendMessage = vi
      .spyOn(IFrameHelper, 'sendMessage')
      .mockImplementation(() => {});
    window.chatwootWebChannel = { inboxId: 1 };
  });

  afterEach(() => {
    connector.disconnect();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete window.chatwootWebChannel;
  });

  it('stores an outgoing history event and emits the native parent event once', () => {
    const message = {
      id: 9,
      inbox_id: 2,
      message_type: 'outgoing',
      sender_type: 'User',
      content: 'Reply in Telegram',
    };
    connector.onReceived({
      event: 'contact.history_message.created',
      data: message,
    });

    expect(dispatch).toHaveBeenCalledWith('contactHistory/addMessage', message);
    expect(dispatch).not.toHaveBeenCalledWith(
      'conversation/addOrUpdateMessage',
      expect.anything()
    );
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
      event: 'onEvent',
      eventIdentifier: CHATWOOT_ON_MESSAGE,
      data: { ...message, message_type: 1 },
    });
  });

  it('stores incoming history without notifying the parent about an operator reply', () => {
    const message = { id: 10, message_type: 'incoming' };
    connector.onReceived({
      event: 'contact.history_message.created',
      data: message,
    });

    expect(dispatch).toHaveBeenCalledWith('contactHistory/addMessage', message);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('refreshes history on reconnect', () => {
    connector.onReconnect();
    expect(dispatch).toHaveBeenCalledWith('contactHistory/fetch');
  });

  it('ignores native events from other inboxes even before an active conversation exists', () => {
    connector.onReceived({
      event: 'message.created',
      data: { id: 9, inbox_id: 2, message_type: 1 },
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('still delivers native replies from the current inbox', () => {
    const message = { id: 11, inbox_id: 1, message_type: 1 };
    connector.onReceived({ event: 'message.created', data: message });

    expect(dispatch).toHaveBeenCalledWith(
      'conversation/addOrUpdateMessage',
      message
    );
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
      event: 'onEvent',
      eventIdentifier: CHATWOOT_ON_MESSAGE,
      data: message,
    });
  });
});
