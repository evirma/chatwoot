// EVIRMA: Keep cross-channel messages separate from the editable active conversation.
import { getContactHistory } from 'widget/api/contactHistory';

const HISTORY_LIMIT = 100;
const latestMessages = messages =>
  [...new Map(messages.map(message => [message.id, message])).values()]
    .sort((a, b) => a.created_at - b.created_at || a.id - b.id)
    .slice(-HISTORY_LIMIT);

export default {
  namespaced: true,
  state: () => ({ records: [], requestId: 0 }),
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
    },
    setMessages(state, { messages, requestId }) {
      if (requestId !== state.requestId) return;
      // Preserve live messages received while the HTTP request was in flight.
      state.records = latestMessages([...messages, ...state.records]);
    },
    addMessage(state, message) {
      state.records = latestMessages([...state.records, message]);
    },
    reset(state) {
      state.records = [];
      state.requestId += 1;
    },
  },
};
