/**
 * Tests for the account tabs.
 *
 * The integration suite renders these through the route, which only ever
 * reaches them with somebody signed in. These render them directly, because the
 * components declare that the user may be absent: `useAuth().user` is typed
 * `User | null | undefined` by react-oidc-context, and every read of a claim
 * here is written as an optional chain because of it. That is the contract the
 * components state, and a component does not know which route guard sits above
 * it.
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { useAuth } from 'react-oidc-context';
import tabs from 'route/account/AccountTabData';

jest.mock('react-oidc-context', () => ({ useAuth: jest.fn() }));

// The settings form needs the redux store, which is out of scope here. The
// settings tab still owns the profile-URL logic under test, so the form is
// stubbed to let the tab render on its own.
jest.mock('route/account/SettingsForm', () => ({
  __esModule: true,
  default: () => null,
}));

const mockUseAuth = useAuth as jest.Mock;
const profileTab = tabs.find((tab) => tab.label === 'Profile')?.body;
const settingsTab = tabs.find((tab) => tab.label === 'Settings')?.body;

function renderTab(body: React.ReactNode, profile: Record<string, unknown>) {
  mockUseAuth.mockReturnValue({ user: { profile } });
  render(<BrowserRouter>{body}</BrowserRouter>);
}

describe('AccountTabData', () => {
  it('ProfileTab shows the picture and the SSO link for safe values', () => {
    renderTab(profileTab, {
      preferred_username: 'user1',
      groups: [],
      picture: 'https://gitlab.example.com/avatar.png',
      profile: 'https://gitlab.example.com/user1',
    });

    expect(screen.getByTestId('profile-picture')).toHaveAttribute(
      'src',
      'https://gitlab.example.com/avatar.png',
    );
    expect(
      screen.getByRole('link', { name: /SSO OAuth Provider/ }),
    ).toBeInTheDocument();
  });

  it('ProfileTab handles a missing groups claim and unsafe values', () => {
    renderTab(profileTab, {
      preferred_username: 'user1',
      groups: undefined,
      picture: 'relative.png',
      profile: 'not-a-url',
    });

    expect(
      screen.getByText(/did not expose a profile URL/),
    ).toBeInTheDocument();
  });

  it('ProfileTab renders when there is no signed-in user', () => {
    mockUseAuth.mockReturnValue({ user: undefined });
    render(<BrowserRouter>{profileTab}</BrowserRouter>);

    expect(
      screen.getByText(/did not expose a profile URL/),
    ).toBeInTheDocument();
    // No claims at all, so no name, no picture and no groups.
    expect(
      screen.getByText(/does not belong to any groups/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByTestId('profile-picture')).not.toHaveAttribute('src');
  });

  it('SettingsTab links to the provider for a safe URL', () => {
    renderTab(settingsTab, { profile: 'https://gitlab.example.com/user1' });

    expect(
      screen.getByRole('link', { name: /SSO OAuth Provider/ }),
    ).toBeInTheDocument();
  });

  it('SettingsTab falls back to plain text for an unsafe URL', () => {
    renderTab(settingsTab, { profile: 'not-a-url' });

    expect(
      screen.getByText(/your SSO OAuth Provider account page/),
    ).toBeInTheDocument();
  });

  it('SettingsTab renders when there is no signed-in user', () => {
    mockUseAuth.mockReturnValue({ user: undefined });
    render(<BrowserRouter>{settingsTab}</BrowserRouter>);

    expect(
      screen.getByText(/your SSO OAuth Provider account page/),
    ).toBeInTheDocument();
  });
});
