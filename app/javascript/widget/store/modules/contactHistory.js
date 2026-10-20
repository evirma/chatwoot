// EVIRMA: Keep cross-channel messages separate from the editable active conversation.
import { getContactHistory } from 'widget/api/contactHistory';

const HISTORY_LIMIT = 100;
const latestMessages = messages =>
  [...new Map(messages.map(message => [message.id, message])).values()]
    .sort((a, b) => a.created_at - b.created_at || a.id - b.id)
    .slice(-HISTORY_LIMIT);

export default {
  namespaced: true,
  // EVIRMA: Buffer live updates during fetch, including deleted-message tombstones.
  state: () => ({ records: [], pendingUpdates: [], requestId: 0 }),
  actions: {
    async fetch({ state, commit }) {
      commit('startRequest');
      const { requestId } = state;
      try {
        const { data } = await getContactHistory();
        commit('setMessages', { messages: data.payload, requestId });
      } catch (error) {
        // The optional history must not prevent the active conversation from loading.
      }
    },
    addMessage({ commit }, message) {
      commit('addMessage', message);
    },
    reset({ commit }) {
      commit('reset');
    },
  },
  mutations: {
    startRequest(state) {
      state.requestId += 1;
      state.pendingUpdates = [];
    },
    setMessages(state, { messages, requestId }) {
      if (requestId !== state.requestId) return;
      // EVIRMA: Fresh HTTP data wins over old state; newer live changes win over HTTP.
      state.records = latestMessages([
        ...messages,
        ...state.pendingUpdates,
      ]).filter(message => !message.content_attributes?.deleted);
    },
    addMessage(state, message) {
      // EVIRMA: Keep tombstones in the request buffer so stale HTTP cannot restore deletions.
      state.pendingUpdates = latestMessages([...state.pendingUpdates, message]);
      state.records = latestMessages([...state.records, message]).filter(
        record => !record.content_attributes?.deleted
      );
    },
    reset(state) {
      state.records = [];
      state.pendingUpdates = []; // EVIRMA: Clear changes when the contact identity changes.
      state.requestId += 1;
    },
  },
};
