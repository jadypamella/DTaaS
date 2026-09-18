import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useDispatch, useSelector } from 'react-redux';
import ShoppingCart from 'components/cart/ShoppingCart';
import { logDismiss } from 'util/logger/logger';

jest.mock('components/cart/CartList', () => ({
  __esModule: true,
  default: () => <div data-testid="cart-list" />,
}));

jest.mock('util/logger/logger', () => ({
  logDismiss: jest.fn(),
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const anAsset = { path: 'models/pump.fmu', isPrivate: true };

describe('ShoppingCart', () => {
  const dispatch = jest.fn();

  // Both actions need something to act on, so the tests that click one start
  // from a selection that holds an asset. The empty case is its own test.
  const renderCart = (assets: unknown[] = [anAsset]) => {
    (useDispatch as unknown as jest.Mock).mockReturnValue(dispatch);
    (useSelector as unknown as jest.Mock).mockReturnValue({ assets });
    render(<ShoppingCart />);
  };

  describe('with nothing chosen', () => {
    beforeEach(() => renderCart([]));

    it('says what the panel is waiting for instead of showing a blank box', () => {
      expect(screen.getByText(/Nothing chosen yet/)).toBeInTheDocument();
      expect(screen.queryByTestId('cart-list')).not.toBeInTheDocument();
    });

    it('offers neither action, since there is nothing to act on', () => {
      // Proceeding used to carry an empty selection to the next page, which
      // arrived with nothing to build from.
      expect(
        screen.getByRole('button', { name: 'Create a Digital Twin' }),
      ).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    });
  });

  describe('with an asset chosen', () => {
    beforeEach(() => renderCart());

    it('lists what was chosen', () => {
      expect(screen.getByTestId('cart-list')).toBeInTheDocument();
      expect(screen.queryByText(/Nothing chosen yet/)).not.toBeInTheDocument();
    });

    it('opens the clear-cart confirmation dialog when Clear is clicked', () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      expect(screen.getByText('Confirm Clear')).toBeInTheDocument();
    });

    it('closes the dialog without clearing when No is clicked', async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      fireEvent.click(screen.getByRole('button', { name: 'No' }));

      await waitFor(() => {
        expect(screen.queryByText('Confirm Clear')).not.toBeInTheDocument();
      });
    });

    it('logs the dismissal and closes when the dialog is dismissed via Escape', async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

      expect(logDismiss).toHaveBeenCalledWith({
        element: 'dialog',
        label: 'Confirm Clear Cart',
        reason: 'escapeKeyDown',
        context: { cart: { count: 1 } },
      });
      await waitFor(() => {
        expect(screen.queryByText('Confirm Clear')).not.toBeInTheDocument();
      });
    });

    it('navigates to the digital twins page when the selection is carried over', () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Create a Digital Twin' }),
      );
      expect(mockNavigate).toHaveBeenCalledWith('/preview/digitaltwins');
    });
  });
});
