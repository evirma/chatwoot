import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import ActionCableConnector from '../actionCable';
// EVIRMA: Verify operator payloads reach hosts with all widget notification surfaces disabled.
import { IFrameHelper } from '../utils';
import { emitter } from 'shared/helpers/mitt';

const { createSubscription, consumer } = vi.hoisted(() => {
  const createSubscriptionMock = vi.fn((identifier, callbacks) => ({
    ...callbacks,
    identifier: JSON.stringify(identifier),
    unsubscribe: vi.fn(),
  }));
  return {
    createSubscription: createSubscriptionMock,
    consumer: {
      subscriptions: { create: createSubscriptionMock },
      disconnect: vi.fn(),
    },
  };
});

vi.mock('@rails/actioncable', () => ({
  createConsumer: () => consumer,
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
    window.actionCable = connector;
    window.chatwootPubsubToken = 'test-token';
    mockDispatch.mockClear();
    window.chatwootWebChannel = { inboxId: 1 };
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    emitter.all.clear();
    delete window.chatwootWebChannel;
    delete window.actionCable;
    delete window.chatwootPubsubToken;
    vi.useRealTimers();
  });

  // EVIRMA: The rotated token must replace the live subscription without losing callbacks.
  it('re-subscribes on the existing consumer and receives messages with the new token', async () => {
    const originalSubscription = connector.subscription;
    const originalIdentifier = JSON.parse(originalSubscription.identifier);
    const message = {
      id: 42,
      inbox_id: 1,
      conversation_id: 10,
      sender_type: 'Contact',
    };

    ActionCableConnector.refreshConnector('new-pubsub');

    expect(originalSubscription.unsubscribe).toHaveBeenCalledOnce();
    expect(connector.consumer).toBe(consumer);
    expect(createSubscription).toHaveBeenLastCalledWith(
      { ...originalIdentifier, pubsub_token: 'new-pubsub' },
      {
        updatePresence: originalSubscription.updatePresence,
        received: originalSubscription.received,
        disconnected: originalSubscription.disconnected,
      }
    );
    expect(window.chatwootPubsubToken).toBe('new-pubsub');
    connector.subscription.received({
      event: 'message.created',
      data: message,
    });
    await Promise.resolve();
    expect(mockDispatch).toHaveBeenCalledWith(
      'conversation/addOrUpdateMessage',
      message
    );

    ActionCableConnector.refreshConnector('new-pubsub');
    expect(createSubscription).toHaveBeenCalledTimes(2);
    expect(originalSubscription.unsubscribe).toHaveBeenCalledOnce();
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
