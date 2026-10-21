// EVIRMA: Resolve signed identity before mounting Vue or subscribing to the contact websocket.
import { API } from './axios';
import { IFrameHelper, sendMessage } from './utils';
import { SET_USER_ERROR } from '../constants/errorTypes';

export const bootstrapWidget = () =>
  new Promise((resolve, reject) => {
    const onMessage = async event => {
      if (event.source !== window.parent || !IFrameHelper.isAValidEvent(event))
        return;
      const message = IFrameHelper.getMessage(event);
      if (message.event !== 'bootstrap') return;

      window.removeEventListener('message', onMessage);
      try {
        const { data } = await API.post(
          '/api/v1/widget/config',
          {
            website_token: window.chatwootWebChannel.websiteToken,
            user: message.user,
          },
          { headers: { 'X-Auth-Token': message.conversationToken } }
        );
        window.authToken = data.website_channel_config.auth_token;
        window.chatwootPubsubToken = data.contact.pubsub_token;
        if (data.set_user_error) {
          sendMessage({
            event: 'error',
            errorType: SET_USER_ERROR,
            data: data.set_user_error,
          });
        }
        resolve();
      } catch (error) {
        sendMessage({
          event: 'error',
          errorType: SET_USER_ERROR,
          data: error.response?.data || { error: 'Widget bootstrap failed' },
        });
        // EVIRMA: Do not expose Axios request configuration containing the persistent signature.
        reject(new Error('Widget bootstrap failed'));
      }
    };
    window.addEventListener('message', onMessage);
    sendMessage({ event: 'bootstrap-request' });
  });
