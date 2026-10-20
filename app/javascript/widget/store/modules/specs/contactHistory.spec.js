// EVIRMA: Exercise HTTP/live-message races and identity reset using the real Vuex module.
import { createStore } from 'vuex';
import { API } from 'widget/helpers/axios';
import contactHistory from '../contactHistory';

vi.mock('widget/helpers/axios', () => ({ API: { get: vi.fn() } }));

describe('contactHistory', () => {
  let store;

  beforeEach(() => {
    store = createStore({ modules: { contactHistory } });
  });

  it('fetches through the widget API and merges live arrivals without duplicates', async () => {
    let resolveRequest;
    API.get.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRequest = resolve;
        })
    );
    const pending = store.dispatch('contactHistory/fetch');
    const liveMessage = { id: 3, created_at: 30, content: 'Live reply' };
    await store.dispatch('contactHistory/addMessage', liveMessage);
    resolveRequest({
      data: { payload: [{ id: 1, created_at: 10 }, liveMessage] },
    });
    await pending;

    expect(API.get).toHaveBeenCalledWith('/api/v1/widget/contact_history');
    expect(
      store.state.contactHistory.records.map(message => message.id)
    ).toEqual([1, 3]);
  });

  it('does not restore a previous contact history after an identity reset', async () => {
    let resolveRequest;
    API.get.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRequest = resolve;
        })
    );
    const pending = store.dispatch('contactHistory/fetch');
    await store.dispatch('contactHistory/addMessage', {
      id: 1,
      created_at: 10,
    });
    await store.dispatch('contactHistory/reset');
    resolveRequest({ data: { payload: [{ id: 2, created_at: 20 }] } });
    await pending;

    expect(store.state.contactHistory.records).toEqual([]);
  });

  it('keeps the latest 100 messages in time order when live events arrive out of order', async () => {
    API.get.mockResolvedValue({
      data: {
        payload: Array.from({ length: 100 }, (_, id) => ({
          id: id + 1,
          created_at: id + 1,
        })),
      },
    });
    await store.dispatch('contactHistory/fetch');
    await store.dispatch('contactHistory/addMessage', {
      id: 102,
      created_at: 102,
    });
    await store.dispatch('contactHistory/addMessage', {
      id: 101,
      created_at: 101,
    });
    await store.dispatch('contactHistory/addMessage', {
      id: 101,
      created_at: 101,
    });

    expect(store.state.contactHistory.records).toHaveLength(100);
    expect(store.state.contactHistory.records[0].id).toBe(3);
    expect(store.state.contactHistory.records.at(-1).id).toBe(102);
  });

  // EVIRMA: Live edits/deletions must beat an older response already in flight.
  it('does not resurrect a deletion when the history request finishes', async () => {
    let resolveRequest;
    API.get.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRequest = resolve;
        })
    );
    const pending = store.dispatch('contactHistory/fetch');
    await store.dispatch('contactHistory/addMessage', {
      id: 1,
      created_at: 10,
      content_attributes: { deleted: true },
    });
    resolveRequest({
      data: { payload: [{ id: 1, created_at: 10, content: 'Old text' }] },
    });
    await pending;
    expect(store.state.contactHistory.records).toEqual([]);
  });

  it('refreshes existing text after reconnect and applies live edits once', async () => {
    await store.dispatch('contactHistory/addMessage', {
      id: 1,
      created_at: 10,
      content: 'Old text',
    });
    API.get.mockResolvedValue({
      data: { payload: [{ id: 1, created_at: 10, content: 'Edited offline' }] },
    });
    await store.dispatch('contactHistory/fetch');
    expect(store.state.contactHistory.records[0].content).toBe(
      'Edited offline'
    );
    await store.dispatch('contactHistory/addMessage', {
      id: 1,
      created_at: 10,
      content: 'Edited live',
      content_attributes: { edited_at: 'now' },
    });
    expect(store.state.contactHistory.records).toHaveLength(1);
    expect(store.state.contactHistory.records[0].content).toBe('Edited live');
    expect(
      store.state.contactHistory.records[0].content_attributes.edited_at
    ).toBe('now');
  });

  it('does not prevent the current conversation from loading when history fails', async () => {
    API.get.mockRejectedValue(new Error('Network error'));

    await expect(
      store.dispatch('contactHistory/fetch')
    ).resolves.toBeUndefined();
    expect(store.state.contactHistory.records).toEqual([]);
  });
});
