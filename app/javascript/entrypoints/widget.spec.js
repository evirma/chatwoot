// EVIRMA: A pending bootstrap must prevent Vue mounting and ActionCable subscription.
const { mount, connect, bootstrapWidget, app } = vi.hoisted(() => {
  const mountWidget = vi.fn(() => ({ mounted: true }));
  const widgetApp = { use: vi.fn(), directive: vi.fn(), mount: mountWidget };
  return {
    mount: mountWidget,
    connect: vi.fn(),
    bootstrapWidget: vi.fn(),
    app: widgetApp,
  };
});

vi.mock('vue', () => ({ createApp: () => app }));
vi.mock('vue-i18n', () => ({ createI18n: vi.fn() }));
vi.mock('vue-dompurify-html', () => ({ default: {} }));
vi.mock('@formkit/vue', () => ({ plugin: {}, defaultConfig: vi.fn() }));
vi.mock('../widget/store', () => ({ default: {} }));
vi.mock('../widget/App.vue', () => ({ default: {} }));
vi.mock('../widget/router', () => ({ default: {} }));
vi.mock('../widget/i18n', () => ({ default: {} }));
vi.mock('../widget/helpers/actionCable', () => ({ default: connect }));
vi.mock('../widget/helpers/bootstrap', () => ({ bootstrapWidget }));

describe('widget startup', () => {
  beforeEach(async () => {
    vi.resetModules();
    await import('./widget');
  });

  afterEach(() => {
    delete window.chatwootBootstrap;
    delete window.chatwootPubsubToken;
    delete window.WOOT_WIDGET;
    delete window.actionCable;
    window.onload = null;
    vi.clearAllMocks();
  });

  it('mounts and subscribes only after bootstrap resolves with the final pubsub token', async () => {
    window.chatwootBootstrap = true;
    let resolveBootstrap;
    bootstrapWidget.mockReturnValue(
      new Promise(resolve => {
        resolveBootstrap = resolve;
      })
    );
    const startup = window.onload();
    expect(mount).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    window.chatwootPubsubToken = 'identified-pubsub';
    resolveBootstrap();
    await startup;
    expect(mount).toHaveBeenCalledExactlyOnceWith('#app');
    expect(connect).toHaveBeenCalledWith(
      window.WOOT_WIDGET,
      'identified-pubsub'
    );
  });

  it('keeps legacy startup synchronous when bootstrap is disabled', () => {
    window.chatwootPubsubToken = 'legacy-pubsub';
    window.onload();
    expect(bootstrapWidget).not.toHaveBeenCalled();
    expect(mount).toHaveBeenCalledExactlyOnceWith('#app');
    expect(connect).toHaveBeenCalledWith(window.WOOT_WIDGET, 'legacy-pubsub');
  });

  // EVIRMA: A failed bootstrap cannot subscribe using an absent or previous identity.
  it('does not mount or connect after a bootstrap failure', async () => {
    window.chatwootBootstrap = true;
    bootstrapWidget.mockRejectedValue(new Error('Widget bootstrap failed'));
    await expect(window.onload()).rejects.toThrow('Widget bootstrap failed');
    expect(mount).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });
});
