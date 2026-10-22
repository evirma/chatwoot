import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import ActionCableConnector from '../actionCable';
// EVIRMA: Verify operator payloads reach hosts with all widget notification surfaces disabled.
import { IFrameHelper } from '../utils';
import { emitter } from 'shared/helpers/mitt';

vi.mock('@rails/actioncable', () => ({
  createConsumer: () => ({
    subscriptions: { create: () => ({}) },
    disconnect: vi.fn(),
  }),
}));

describe('Widget ActionCableConnector', () => {
  let app;
  let mockDispatch;
  let connector;

  beforeEach(() => {
    vi.useFakeTimers();
    mockDispatch = vi.fn().mockResolvedValue();
    app = {
      $store: {
        dispatch: mockDispatch,
        getters: {
          getCurrentAccountId: 1,
          getCurrentUserID: 1,
          // EVIRMA: Operator events must not depend on widget visibility or dialog settings.
          'conversationAttributes/getConversationParams': { id: 10 },
          'appConfig/getHideMessageBubble': true,
          'appConfig/getShowUnreadMessagesDialog': false,
          'appConfig/getIsWidgetOpen': false,
        },
      },
    };
    connector = new ActionCableConnector(app, 'test-token');
    mockDispatch.mockClear();
    window.chatwootWebChannel = { inboxId: 1 };
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    emitter.all.clear();
    delete window.chatwootWebChannel;
    vi.useRealTimers();
  });

  // EVIRMA: Cross-channel changes update history without creating a notification.
  it('delivers a history deletion to the history store', () => {
    const message = { id: 10, content_attributes: { deleted: true } };
    connector.events['contact.history_message.updated'](message);
    expect(mockDispatch).toHaveBeenCalledExactlyOnceWith(
      'contactHistory/addMessage',
      message
    );
  });

  it('registers the conversation.status_changed event handler', () => {
    expect(connector.events['conversation.status_changed']).toBe(
      connector.onStatusChange
    );
  });

  it('re-fetches conversation attributes on reconnect so a status change missed while disconnected is reflected', () => {
    connector.onReconnect();

    expect(mockDispatch).toHaveBeenCalledWith(
      'conversation/syncLatestMessages'
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      'conversationAttributes/getAttributes'
    );
  });

  // EVIRMA: Preserve message text, attachment URLs and sender type in closed-widget events.
  it('notifies the host of operator messages while closed', async () => {
    const sendMessage = vi
      .spyOn(IFrameHelper, 'sendMessage')
      .mockImplementation(() => {});
    const message = {
      id: 42,
      inbox_id: 1,
      conversation_id: 10,
      content: 'Reply',
      sender_type: 'User',
      message_type: 1,
      sender: { id: 7, name: 'Support' },
      attachments: [
        {
          id: 1,
          file_type: 'image',
          data_url: 'https://support.example/file.png',
        },
      ],
      additional_attributes: {},
    };
    connector.onReceived({ event: 'message.created', data: message });
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith({
      event: 'onEvent',
      eventIdentifier: 'chatwoot:on-message',
      data: message,
    });
    expect(mockDispatch).toHaveBeenCalledWith(
      'conversation/addOrUpdateMessage',
      message
    );
  });
});
