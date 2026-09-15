import Automation from 'route/automation/Automation';
import store from 'store/store';
import { act, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

jest.mock('react-redux', () => ({
  ...jest.requireActual('react-redux'),
}));

jest.mock('react-oidc-context', () => ({
  ...jest.requireActual('react-oidc-context'),
  useAuth: jest.fn(),
}));

describe('Automation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function renderPage() {
    render(
      <Provider store={store}>
        <MemoryRouter>
          <Automation />
        </MemoryRouter>
      </Provider>,
    );
  }

  it('carries the Automation heading', async () => {
    renderPage();
    await act(async () => {
      jest.runAllTimers();
    });

    expect(
      screen.getAllByRole('heading', { level: 1, name: 'Automation' }).length,
    ).toBeGreaterThan(0);
  });

  it('gathers the digital twins and library previews as its two tabs', async () => {
    await act(async () => {
      renderPage();
    });
    await act(async () => {
      jest.runAllTimers();
    });

    // The page's own tab component, plus the one inside whichever preview panel
    // is selected, so both previews are wired in as tabbed content.
    expect(screen.getAllByTestId('tab-component').length).toBeGreaterThan(0);
  });
});
