// EVIRMA: Verify identity bootstrap at the parent-message and HTTP boundaries.
import { flushPromises } from '@vue/test-utils';
import { API } from '../axios';
import { bootstrapWidget } from '../bootstrap';
import { SET_USER_ERROR } from '../../constants/errorTypes';

describe('signed widget bootstrap', () => {
  const user = {
    identifier: 'customer',
    identifier_hash: 'signed-hash',
    name: 'Customer',
    email: 'customer@example.com',
  };
  const config = {
    website_channel_config: { auth_token: 'final-token' },
    contact: { pubsub_token: 'final-pubsub' },
  };
  let postMessage;

  beforeEach(() => {
    window.chatwootWebChannel = { websiteToken: 'website' };
    postMessage = vi
      .spyOn(window.parent, 'postMessage')
      .mockImplementation(() => {});
    vi.spyOn(API, 'post').mockResolvedValue({ data: config });
  });

  afterEach(() => {
    delete window.chatwootWebChannel;
    delete window.chatwootPubsubToken;
    delete window.authToken;
    vi.restoreAllMocks();
  });

  it('posts the signature in the body and installs only final auth and pubsub tokens', async () => {
    let resolveRequest;
    API.post.mockReturnValue(
      new Promise(resolve => {
        resolveRequest = resolve;
      })
    );
    const bootstrapped = vi.fn();
    const promise = bootstrapWidget().then(bootstrapped);
    expect(postMessage).toHaveBeenCalledWith(
      'chatwoot-widget:{"event":"bootstrap-request"}',
      '*'
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: `chatwoot-widget:${JSON.stringify({ event: 'bootstrap', user, conversationToken: 'guest-token' })}`,
      })
    );
    await flushPromises();
    expect(API.post).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/widget/config',
      {
        website_token: 'website',
        user,
      },
      { headers: { 'X-Auth-Token': 'guest-token' } }
    );
    expect(bootstrapped).not.toHaveBeenCalled();
    expect(window.authToken).toBeUndefined();

    resolveRequest({ data: config });
    await promise;
    expect(window.authToken).toBe('final-token');
    expect(window.chatwootPubsubToken).toBe('final-pubsub');
  });

  it('ignores foreign sources and unrelated messages, then consumes the parent response only once', async () => {
    const promise = bootstrapWidget();
    const data = `chatwoot-widget:${JSON.stringify({ event: 'bootstrap', user, conversationToken: null })}`;
    window.dispatchEvent(new MessageEvent('message', { data, source: null }));
    window.dispatchEvent(
      new MessageEvent('message', { data: 'other', source: window.parent })
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: 'chatwoot-widget:{"event":"config-set"}',
        source: window.parent,
      })
    );
    expect(API.post).not.toHaveBeenCalled();
    window.dispatchEvent(
      new MessageEvent('message', { data, source: window.parent })
    );
    window.dispatchEvent(
      new MessageEvent('message', { data, source: window.parent })
    );
    await promise;
    expect(API.post).toHaveBeenCalledTimes(1);
  });

  it('forwards the same set-user error while completing anonymous bootstrap after invalid HMAC', async () => {
    const error = { error: 'HMAC failed: Invalid Identifier Hash Provided' };
    API.post.mockResolvedValue({ data: { ...config, set_user_error: error } });
    const promise = bootstrapWidget();
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: `chatwoot-widget:${JSON.stringify({ event: 'bootstrap', user })}`,
      })
    );
    await promise;
    expect(postMessage).toHaveBeenCalledWith(
      `chatwoot-widget:${JSON.stringify({ event: 'error', errorType: SET_USER_ERROR, data: error })}`,
      '*'
    );
    expect(window.authToken).toBe('final-token');
  });

  // EVIRMA: Network failures must not leak the signed Axios request through an unhandled rejection.
  it('reports request failure without exposing the request body or installing tokens', async () => {
    API.post.mockRejectedValue({ config: { data: user } });
    const promise = bootstrapWidget();
    const failure = expect(promise).rejects.toThrow('Widget bootstrap failed');
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: `chatwoot-widget:${JSON.stringify({ event: 'bootstrap', user })}`,
      })
    );
    await failure;
    expect(window.authToken).toBeUndefined();
    expect(window.chatwootPubsubToken).toBeUndefined();
    expect(postMessage.mock.calls.at(-1)[0]).not.toContain('signed-hash');
  });
});
